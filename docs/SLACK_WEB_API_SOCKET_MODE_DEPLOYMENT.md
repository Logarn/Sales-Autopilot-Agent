# Slack Web API + Socket Mode Deployment Notes

PR #14 assumes production Slack mode uses the Slack Web API plus Socket Mode.
Webhook posting is fallback only.

## Required Slack Bot Token Scopes

Bot token scopes for `SLACK_BOT_TOKEN`:

- `chat:write` - post parent lead messages and thread replies with `chat.postMessage`.
- `app_mentions:read` - receive mention events that claim shared-channel threads.
- `channels:history` - receive message events in public channels where the bot is installed.
- `im:history` - receive direct messages with the bot.
- `groups:history` - receive message events in private channels where the bot is installed, if the production channel is private.

Optional, only if intentionally needed:

- `chat:write.public` - only if the bot must post to public channels it has not joined. Prefer inviting the bot to the channel instead.
- `mpim:history` - only if multi-person DMs are intentionally enabled as an agent surface.

## Required App-Level Scope

App-level token scope for `SLACK_APP_TOKEN`:

- `connections:write` - required by Slack Socket Mode.

## Required Bot Events

Subscribe to bot events:

- `app_mention` - explicit mention can summon the bot and claim that thread.
- `message.channels` - public channel messages and thread replies.
- `message.im` - direct messages with the bot.
- `message.groups` - private channel messages and thread replies, if the production channel is private.

The Socket Mode handler listens for Slack `message` and `app_mention` events, ignores bot messages, maps the event's `thread_ts` to the tracked opportunity, and replies in the same thread. Untagged prompt mode is limited to DMs, bot-owned threads, claimed threads, and configured ambient agent channels such as `#sales_leads`.

After changing scopes or event subscriptions in Slack, reinstall the Slack app to the workspace before testing live inbound messages.

## Required Contabo Environment Variables

Slack Web API and Socket Mode:

```bash
SLACK_BOT_TOKEN=<bot-token>
SLACK_APP_TOKEN=<app-level-token>
SLACK_SOCKET_MODE_ENABLED=true
SLACK_INBOUND_MODE=socket_mode
DISCOVERY_SLACK_CHANNEL_ID=C0123456789
SLACK_ALLOWED_CHANNEL_IDS=C0123456789
SLACK_AGENT_AMBIENT_CHANNEL_IDS=C0AQW8W6RFU
```

Fallback only:

```bash
SLACK_CHANNEL_WEBHOOK_URL=https://hooks.slack.com/services/...
```

Not required for Socket Mode:

```bash
SLACK_SIGNING_SECRET=
SLACK_POLL_CHANNEL_ID=
```

`SLACK_ALLOWED_CHANNEL_IDS` should include the same channel as `DISCOVERY_SLACK_CHANNEL_ID` in production so inbound replies from other channels are ignored.

Run `npm run slack:socket` as its own supervised process alongside the lead engine/browser worker processes.

PR #14 includes the durable service template:

```bash
deploy/systemd/upwork-agent-slack-socket.service
```

The unit runs as `upwork-agent`, uses `/opt/upwork-agent/app` as its working directory, loads `/opt/upwork-agent/app/.env`, starts `npm run slack:socket`, restarts on failure, and relies on `journalctl` for logging. It does not contain secret values.

## Threaded Posting Smoke Test

Build first:

```bash
npm run build
```

Post a parent message and a thread reply through the same Web API path used by PR #14:

```bash
SLACK_BOT_TOKEN="$SLACK_BOT_TOKEN" \
DISCOVERY_SLACK_CHANNEL_ID="$DISCOVERY_SLACK_CHANNEL_ID" \
node - <<'NODE'
const { postSlackChannelMessage, postSlackThreadMessage } = require("./dist/slackThread");

(async () => {
  const channel = process.env.DISCOVERY_SLACK_CHANNEL_ID;
  if (!channel) throw new Error("DISCOVERY_SLACK_CHANNEL_ID is required");

  const parent = await postSlackChannelMessage({
    channel,
    text: "Slack Web API smoke: parent lead message",
  });
  console.log(JSON.stringify(parent));
  if (!parent.ok || !parent.ts) throw new Error("parent post failed");

  const replyOk = await postSlackThreadMessage({
    channel: parent.channel || channel,
    threadTs: parent.ts,
    text: "Slack Web API smoke: threaded preparation update",
  });
  console.log(JSON.stringify({ replyOk }));
  if (!replyOk) throw new Error("thread reply failed");
})();
NODE
```

Expected result:

- one parent message appears in `DISCOVERY_SLACK_CHANNEL_ID`
- one reply appears inside that parent message thread
- output includes `ok: true` and a parent `ts`

## Inbound Thread Reply Smoke Test

Non-live parser/handler regression test:

```bash
npm run test:slack-socket
```

Live Socket Mode process:

```bash
SLACK_SOCKET_MODE_ENABLED=true \
SLACK_BOT_TOKEN="$SLACK_BOT_TOKEN" \
SLACK_APP_TOKEN="$SLACK_APP_TOKEN" \
SLACK_ALLOWED_CHANNEL_IDS="$SLACK_ALLOWED_CHANNEL_IDS" \
npm run slack:socket
```

Systemd production listener:

```bash
sudo cp deploy/systemd/upwork-agent-slack-socket.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now upwork-agent-slack-socket.service
journalctl -u upwork-agent-slack-socket.service -f
```

Then in the allowed Slack channel:

1. Reply in a tracked opportunity thread with `status`.
2. Reply with `What are the red flags?`.
3. Reply with `Skip this.`.
4. Reply with `Retry prep.` after a paused or failed browser action exists.

Expected result:

- the agent replies in the same Slack thread
- `status` / `why` / `red flags` return deeper context on demand
- `Skip this.` marks the tracked application rejected
- `Retry prep.` requeues the latest paused or failed capture/prep action for that thread

## Degraded Behavior Without Socket Mode

If `SLACK_SOCKET_MODE_ENABLED`, `SLACK_APP_TOKEN`, `SLACK_INBOUND_MODE=socket_mode`, or bot message events are not configured:

- outbound Web API parent messages and thread replies can still work if `SLACK_BOT_TOKEN` and `DISCOVERY_SLACK_CHANNEL_ID` are configured
- inbound natural thread replies do not work
- manual thread commands like `status`, `skip`, `revise`, and `retry prep` do not work through Slack
- the local CLI/tests remain available for non-live command validation

If only `SLACK_CHANNEL_WEBHOOK_URL` is configured:

- Slack can receive fallback standalone alerts
- Slack does not return a parent `ts`
- the app cannot persist a reliable `channel_id + thread_ts` mapping from webhook delivery
- one-job-one-thread lifecycle is degraded and prep updates may not thread under the lead alert

Final submit remains manual in all Slack configurations.
