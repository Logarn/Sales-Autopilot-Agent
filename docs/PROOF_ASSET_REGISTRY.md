# Proof Asset Registry

Proof files are production data, not source code. Keep PDFs, screenshots, and other client proof files outside Git and point the agent at them with `PROOF_ASSET_ROOT`.

Recommended Contabo layout:

```text
/opt/upwork-agent/shared/proof-assets/
  profile/
    attachments/
      truly-beauty-case-study.pdf
      fly-boutique-case-study.pdf
      design-case-studies-steve-logarn.pdf
    screenshots/
      dr-rachael-klaviyo-performance.png
```

Set this in production:

```bash
PROOF_ASSET_ROOT=/opt/upwork-agent/shared/proof-assets
```

The committed manifest remains `profile/portfolio-assets.json`. Paths in that file stay relative to the proof asset root, for example `profile/attachments/fly-boutique-case-study.pdf`.

Each proof asset entry is treated as:

- `file`: a local PDF/image that can only be attached when it exists under `PROOF_ASSET_ROOT` and the manifest marks it safe.
- `mention_only`: proof that may be referenced in draft copy but must not be attached.
- `upwork_portfolio`: existing Upwork profile/portfolio proof that must be selected on the apply page before it can be claimed.
- `certificate`: existing Upwork certificate proof that must be selected on the apply page before it can be claimed.

Current page behavior:

- If Upwork shows existing selectable profile highlights, the agent may check them and only reports success when checked labels verify.
- If Upwork only shows `Add portfolio project` or `Add certificate`, the agent reports proof unavailable on page.
- The agent must not say proof was selected unless a page selection verified.
- The agent must not say files were attached unless uploaded filenames verify on the page.

Audit commands:

```bash
npm run proof:check
npm run assets:check
npm run proof:check -- --json
npm run proof:check -- --paths
```

The default audit reports available local files, missing files, mention-only proof, portfolio/certificate setup required, and files that should not be attached automatically. It does not print absolute local paths unless `--paths` is passed.

## Slack Intake

Slack-uploaded files are job-specific. When Steve or Natalie attaches supported files in a tracked job thread, the Slack socket downloads them with the bot token, checks the file size and basic file signature, classifies the file, and stores accepted files under:

```text
/opt/upwork-agent/shared/proof-assets/slack-intake/<jobId>/<classification>/
```

The agent registers accepted files against the current application. This does not edit `profile/portfolio-assets.json`; the committed manifest remains the canonical reusable proof library.

Classification behavior:

- New case studies, proof files, and screenshots are stored for manual proof review. Exact filename replacements for known portfolio attachments may be attached for the current prep plan, but must not be claimed as verified proof until page verification succeeds.
- Client assets such as logos, brand files, product images, or named creatives are scoped to the current application and may be attached when the browser prep plan needs them.
- Temporary context such as briefs, notes, requirements, or job context is scoped to the current thread/application and is not attachable proof.
- Unclear supported files are stored for review and the agent asks Steve what the file is for before using it.
- Irrelevant or likely sensitive files such as invoices, billing/tax material, credentials, tokens, or secrets are not stored.

Slack app requirements:

- Bot token scope: `files:read`
- Socket events must include message/file events for the target channel.
- Configure `SLACK_FILE_MAX_BYTES` and `SLACK_FILE_ALLOWED_EXTENSIONS` if production limits need to differ from the defaults.

Default accepted extensions are `.pdf`, `.png`, `.jpg`, `.jpeg`, and `.webp`. Unsupported, oversized, mismatched, irrelevant, or likely sensitive files are rejected and reported in-thread by filename only. Private Slack URLs, bot tokens, and file contents are not printed.
