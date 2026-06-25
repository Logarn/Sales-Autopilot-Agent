import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function cleanupDatabase(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
  const dir = dirname(path);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

function ensureProofAsset(root: string, relativePath: string): void {
  const fullPath = resolve(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, "test proof asset\n");
  }
}

async function runTests(): Promise<void> {
  const tempDb = resolve(process.cwd(), "data/.tmp-batch-apply-workspace/jobs.db");
  cleanupDatabase(tempDb);
  mkdirSync(dirname(tempDb), { recursive: true });
  process.env.DB_PATH = tempDb;
  const proofAssetRoot = resolve(process.cwd(), "data/.tmp-batch-apply-workspace/proof-assets");
  process.env.PROOF_ASSET_ROOT = proofAssetRoot;
  process.env.BROWSER_QA_MAX_PROTECTED_TABS = "10";
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  process.env.SLACK_ALLOWED_USER_IDS = "U_ALLOWED";

  const {
    handleThreadCommand,
    parseSlackThreadCommand,
    queuePrepareDraftFromSlackThread,
  } = require("./slackSocket") as {
    handleThreadCommand: (input: {
      channelId: string;
      threadTs: string;
      text: string;
      client: { chat: { postMessage: (payload: { text: string }) => Promise<void> } };
      focusQaTab?: (input: { jobId?: string | null; index?: number; query?: string | null }) => Promise<{ ok: boolean; text: string }>;
    }) => Promise<void>;
    parseSlackThreadCommand: (text: string) => { type: string; batchTargetCount?: number; qaIndex?: number };
    queuePrepareDraftFromSlackThread: (input: { channelId: string; threadTs: string }) => { ok: boolean; actionId?: number; text: string };
  };
  const {
    closeDb,
    getApplicationStatus,
    listBatchApplyWorkspaceItems,
    listBrowserActions,
    markJobSeen,
    mergeBrowserActionPayload,
    updateBrowserActionStatus,
    updateApplicationStatus,
    upsertSlackThreadState,
  } = require("./db") as {
    closeDb: () => void;
    getApplicationStatus: (jobId: string) => string | null;
    listBatchApplyWorkspaceItems: (batchId: number) => Array<{ jobId: string; status: string }>;
    listBrowserActions: (status?: string | null, limit?: number) => Array<{ id: number; actionType: string; jobId: string; status: string; payload: Record<string, unknown> }>;
    markJobSeen: (job: any, notified: boolean) => void;
    mergeBrowserActionPayload: (id: number, patch: Record<string, unknown>) => void;
    updateBrowserActionStatus: (id: number, status: string, lastError?: string) => boolean;
    updateApplicationStatus: (jobId: string, status: string, note?: string) => boolean;
    upsertSlackThreadState: (input: any) => void;
  };
  const {
    focusProtectedQaApplicationTab,
    getBatchApplyWorkspaceView,
  } = require("./browserQaWorkspace") as {
    focusProtectedQaApplicationTab: (input: { index?: number }, deps: { chromium: any; acquireSession: any }) => Promise<{ ok: boolean; text: string }>;
    getBatchApplyWorkspaceView: () => { id: number | null; items: Array<{ index: number; jobId: string; status: string }>; counts: Record<string, number> };
  };
  const { buildApplicationDraft } = require("./agent") as { buildApplicationDraft: (job: any) => any };
  const { scoreJob } = require("./filter") as { scoreJob: (job: any) => any };

  try {
    assert(parseSlackThreadCommand("prep the next 10").type === "batch_prep", "prep next 10 should parse as batch_prep.");
    assert(parseSlackThreadCommand("prep the next 10").batchTargetCount === 10, "prep next 10 should target 10.");
    assert(parseSlackThreadCommand("prep strong ones").type === "batch_prep", "prep strong ones should parse as batch_prep.");
    assert(parseSlackThreadCommand("open application 7").qaIndex === 7, "open application 7 should parse an indexed focus.");
    assert(parseSlackThreadCommand("skip application 7").type === "skip_batch_item", "skip application 7 should parse as skip_batch_item.");
    assert(parseSlackThreadCommand("mark application 7 submitted").type === "mark_batch_submitted", "mark application submitted should parse as mark_batch_submitted.");

    for (let i = 1; i <= 12; i += 1) {
      const job = scoreJob({
        id: `batch-job-${String(i).padStart(2, "0")}`,
        title: `Klaviyo Shopify batch candidate ${i}`,
        url: `https://www.upwork.com/jobs/~batchjob${String(i).padStart(2, "0")}`,
        description: "Shopify brand needs Klaviyo flows, campaigns, segmentation, and retention strategy.",
        postedAt: new Date(Date.now() - i * 1000).toISOString(),
        budget: "$50-$75/hr",
        clientCountry: "United States",
        clientRating: 4.9,
        clientSpend: 100000 + i,
        clientHireRate: 80,
        clientTotalHires: 20,
        clientFeedbackCount: 12,
        category: "Digital Marketing",
        experienceLevel: "Expert",
        connectsCost: 4,
        skills: ["Klaviyo", "Shopify", "Retention Marketing"],
        sourceQuery: "manual",
      });
      job.applicationDraft = buildApplicationDraft(job);
      for (const item of job.applicationDraft.selectedPortfolioItems) {
        ensureProofAsset(proofAssetRoot, item.filePath);
      }
      for (const path of job.applicationDraft.proofStrategy?.selectedAttachmentPaths ?? []) {
        ensureProofAsset(proofAssetRoot, path);
      }
      if (i === 1) {
        job.applicationDraft = {
          ...job.applicationDraft,
          draftQualityGate: {
            ...job.applicationDraft.draftQualityGate,
            ready: false,
            issues: [
              ...(job.applicationDraft.draftQualityGate?.issues ?? []),
              { severity: "critical", code: "legacy_overlay_noise", message: "Legacy noisy capture requires regeneration." },
            ],
          },
          skillUseTrace: job.applicationDraft.skillUseTrace
            ? {
                ...job.applicationDraft.skillUseTrace,
                browserFillAllowed: false,
              }
            : job.applicationDraft.skillUseTrace,
        };
      }
      markJobSeen(job, false);
      upsertSlackThreadState({
        channelId: "CBATCH",
        messageTs: `100.${i}`,
        threadTs: `100.${i}`,
        upworkUrl: job.url,
        jobId: job.id,
        status: "packet_sent",
      });
    }

    const replies: string[] = [];
    await handleThreadCommand({
      channelId: "CBATCH",
      threadTs: "root.001",
      text: "prep the next 10",
      client: { chat: { postMessage: async (payload: { text: string }) => { replies.push(payload.text); } } },
    });
    assert(replies.some((reply) => reply.includes("Batch workspace started") && reply.includes("10/10")), "Batch command should start a 10-item workspace.");
    assert(replies.some((reply) => reply.includes("1 skipped")), "Batch command should report skipped invalid candidates.");
    assert(replies.join("\n").includes("Final submit remains manual"), "Batch start reply must preserve manual final submit.");

    const view = getBatchApplyWorkspaceView();
    assert(view.id !== null, "Batch workspace should be active.");
    assert(view.items.length === 10, `Expected 10 batch items, got ${view.items.length}.`);
    assert(view.counts.queued === 10, `Expected 10 queued items, got ${view.counts.queued}.`);
    assert(listBatchApplyWorkspaceItems(view.id!).length === 10, "Workspace table should persist 10 items.");
    const batchActions = listBrowserActions(null, 1000).filter((action) => action.actionType === "prepare_application_review");
    assert(batchActions.length === 10, "Batch start should queue exactly 10 prepare actions.");
    assert(!batchActions.some((action) => action.jobId === "batch-job-01"), "Invalid browser-fill drafts should be skipped instead of being queued.");
    for (const action of batchActions) {
      updateBrowserActionStatus(action.id, "paused", "Draft prepared for human QA in remote Chrome. Reopen it from the saved apply link before review; final submit was not clicked.");
      updateApplicationStatus(action.jobId, "prepared_for_qa", "Test protected QA hold.");
      mergeBrowserActionPayload(action.id, {
        qaHold: {
          protected: true,
          doNotReuse: true,
          do_not_reuse: true,
          jobId: action.jobId,
          applyUrl: `https://www.upwork.com/ab/proposals/job/~${action.jobId.replace(/[^a-z0-9]/gi, "")}/apply/`,
          status: "prepared_for_qa",
        },
      });
    }

    const eleventh = queuePrepareDraftFromSlackThread({ channelId: "CBATCH", threadTs: "100.12" });
    assert(!eleventh.ok && eleventh.text.includes("10 applications waiting for QA"), "Protected tab cap should stop the eleventh prep.");

    const firstAction = listBrowserActions(null, 1000).find((action) => action.jobId === view.items[0]?.jobId && action.actionType === "prepare_application_review");
    assert(Boolean(firstAction), "First batch item should have a browser action.");
    mergeBrowserActionPayload(firstAction!.id, {
      qaHold: {
        protected: true,
        doNotReuse: true,
        do_not_reuse: true,
        jobId: firstAction!.jobId,
        applyUrl: "https://www.upwork.com/ab/proposals/job/~batchjob01/apply/",
        status: "prepared_for_qa",
      },
    });

    let exactTabBroughtForward = false;
    const focusOk = await focusProtectedQaApplicationTab({ index: 1 }, {
      chromium: {},
      acquireSession: async () => ({
        context: {
          pages: () => [
            { url: () => "https://www.upwork.com/jobs/~batchjob01", bringToFront: async () => { throw new Error("same-job listing tab must not be used"); } },
            { url: () => "https://www.upwork.com/ab/proposals/job/~otherjob/apply/", bringToFront: async () => { throw new Error("random tab must not be used"); } },
            { url: () => "https://www.upwork.com/ab/proposals/job/~batchjob01/apply/", bringToFront: async () => { exactTabBroughtForward = true; } },
          ],
        },
        close: async () => {},
      }),
    });
    assert(focusOk.ok, "Exact saved apply tab should focus successfully.");
    assert(exactTabBroughtForward, "Focus should bring the exact matching application tab forward.");

    const focusMissing = await focusProtectedQaApplicationTab({ index: 1 }, {
      chromium: {},
      acquireSession: async () => ({
        context: { pages: () => [{ url: () => "https://www.upwork.com/jobs/~batchjob01" }, { url: () => "https://www.upwork.com/ab/proposals/job/~otherjob/apply/" }] },
        close: async () => {},
      }),
    });
    assert(!focusMissing.ok && focusMissing.text.includes("did not reuse another tab"), "Missing exact tab should fail closed without random tab reuse.");
    assert(getBatchApplyWorkspaceView().items[0]?.status === "tab_missing", "Missing exact tab should mark the batch item tab_missing.");

    const skipReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CBATCH",
      threadTs: "root.001",
      text: "skip application 2",
      client: { chat: { postMessage: async (payload: { text: string }) => { skipReplies.push(payload.text); } } },
    });
    assert(skipReplies.some((reply) => reply.includes("Skipped application 2") && reply.includes("did not submit")), "Skip should acknowledge no submit.");
    assert(getBatchApplyWorkspaceView().items[1]?.status === "skipped", "Skip should mark the item skipped.");

    const submittedReplies: string[] = [];
    await handleThreadCommand({
      channelId: "CBATCH",
      threadTs: "root.001",
      text: "mark application 3 submitted",
      client: { chat: { postMessage: async (payload: { text: string }) => { submittedReplies.push(payload.text); } } },
    });
    assert(submittedReplies.some((reply) => reply.includes("Final submit remains manual")), "Submitted marker should keep manual-submit boundary.");
    assert(getBatchApplyWorkspaceView().items[2]?.status === "submitted", "Submitted marker should mark the item submitted.");
    assert(getApplicationStatus(getBatchApplyWorkspaceView().items[2]!.jobId) === "submitted", "Submitted marker should update application status.");
  } finally {
    closeDb();
    cleanupDatabase(tempDb);
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
