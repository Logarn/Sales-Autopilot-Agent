import assert from "node:assert/strict";

const SECRET_ENV_KEYS = [
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GROK_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "LMSTUDIO_API_KEY",
] as const;

for (const key of SECRET_ENV_KEYS) {
  process.env[key] = "";
}

async function loadProvider() {
  const resolved = await import("./provider");
  return resolved;
}

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> | void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const restore = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

async function run(): Promise<void> {
  const {
    getLlmProviderConfig,
    getJobIntelligenceProviderConfig,
    getProposalCopyProviderConfig,
    getSlackCopyProviderConfig,
    getSlackCopyProviderFallbackConfigs,
    OpenAiCompatibleProvider,
  } = await loadProvider();

  withEnv({
    LLM_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-key",
    LLM_MODEL: "gpt-4o-mini",
    LLM_BASE_URL: "https://api.openai.com/v1",
  }, () => {
    const config = getLlmProviderConfig();
    assert.equal(config.provider, "openai");
    assert.equal(config.apiKey, "openai-key");
    assert.equal(config.model, "gpt-4o-mini");
  });

  withEnv({
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "or-key",
    OPENROUTER_MODEL: "openai/gpt-4.1-mini",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  }, () => {
    const config = getLlmProviderConfig();
    assert.equal(config.provider, "openrouter");
    assert.equal(config.apiKey, "or-key");
    assert.equal(config.model, "openai/gpt-4.1-mini");
    assert.equal(config.baseUrl, "https://openrouter.ai/api/v1");
  });

  withEnv({
    LLM_PROVIDER: "lmstudio",
    LMSTUDIO_BASE_URL: "http://localhost:1234/v1",
    LMSTUDIO_MODEL: "qwen/qwen3.5-9b",
    LMSTUDIO_API_KEY: "",
    LLM_API_KEY: "",
  }, () => {
    const config = getLlmProviderConfig();
    assert.equal(config.provider, "lmstudio");
    assert.equal(config.apiKey, "lm-studio");
    assert.equal(config.model, "qwen/qwen3.5-9b");
    assert.equal(config.baseUrl, "http://localhost:1234/v1");
  });

  withEnv({ LLM_PROVIDER: "lm-studio", LMSTUDIO_BASE_URL: "http://localhost:1234/v1" }, () => {
    const config = getLlmProviderConfig();
    assert.equal(config.provider, "lmstudio");
  });

  withEnv({
    LLM_PROVIDER: "kimi",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    MOONSHOT_MODEL: "kimi-k2.6",
    LLM_MODEL: "grok-4.3",
  }, () => {
    const config = getLlmProviderConfig();
    assert.equal(config.provider, "moonshot");
    assert.equal(config.apiKey, "moonshot-key");
    assert.equal(config.model, "kimi-k2.6");
    assert.equal(config.baseUrl, "https://api.moonshot.ai/v1");
  });

  withEnv({
    JOB_INTELLIGENCE_ENABLED: "true",
    JOB_INTELLIGENCE_PROVIDER: "xai",
    XAI_API_KEY: "xai-key",
    XAI_BASE_URL: "https://api.x.ai/v1",
    JOB_INTELLIGENCE_MODEL: "grok-4.3",
  }, () => {
    const config = getJobIntelligenceProviderConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "xai");
    assert.equal(config.apiKey, "xai-key");
    assert.equal(config.model, "grok-4.3");
    assert.equal(config.baseUrl, "https://api.x.ai/v1");
  });

  withEnv({
    JOB_INTELLIGENCE_ENABLED: "true",
    JOB_INTELLIGENCE_PROVIDER: "kimi",
    JOB_INTELLIGENCE_MODEL: "grok-4.3",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    MOONSHOT_MODEL: "kimi-k2.6",
    XAI_API_KEY: "xai-key",
  }, () => {
    const config = getJobIntelligenceProviderConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "moonshot");
    assert.equal(config.apiKey, "moonshot-key");
    assert.equal(config.model, "kimi-k2.6");
    assert.equal(config.baseUrl, "https://api.moonshot.ai/v1");
  });

  withEnv({
    SLACK_COPY_LLM_ENABLED: "true",
    SLACK_COPY_PROVIDER: "kimi",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    SLACK_COPY_MODEL: "kimi-k2.6",
  }, () => {
    const config = getSlackCopyProviderConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "moonshot");
    assert.equal(config.apiKey, "moonshot-key");
    assert.equal(config.model, "kimi-k2.6");
    assert.equal(config.baseUrl, "https://api.moonshot.ai/v1");
  });

  withEnv({
    PROPOSAL_COPY_LLM_ENABLED: "true",
    PROPOSAL_COPY_PROVIDER: "kimi",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    PROPOSAL_COPY_MODEL: "kimi-k2.6",
    LLM_PROVIDER: "xai",
    LLM_MODEL: "grok-4.3",
    XAI_API_KEY: "xai-key",
  }, () => {
    const config = getProposalCopyProviderConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "moonshot");
    assert.equal(config.apiKey, "moonshot-key");
    assert.equal(config.model, "kimi-k2.6");
    assert.equal(config.baseUrl, "https://api.moonshot.ai/v1");
  });

  withEnv({
    SLACK_COPY_LLM_ENABLED: "true",
    SLACK_COPY_PROVIDER: "kimi",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    SLACK_COPY_MODEL: "kimi-k2.6",
    XAI_API_KEY: "xai-key",
    XAI_BASE_URL: "https://api.x.ai/v1",
    XAI_MODEL: "grok-4.3",
  }, () => {
    const configs = getSlackCopyProviderFallbackConfigs();
    assert.equal(configs[0]?.provider, "moonshot");
    assert.equal(configs[0]?.model, "kimi-k2.6");
    assert.equal(configs.length, 1);
  });

  withEnv({
    SLACK_COPY_LLM_ENABLED: "true",
    SLACK_COPY_PROVIDER: "kimi",
    MOONSHOT_API_KEY: "moonshot-key",
    MOONSHOT_BASE_URL: "https://api.moonshot.ai/v1",
    SLACK_COPY_MODEL: "kimi-k2.6",
    SLACK_COPY_FALLBACK_PROVIDER: "xai",
    XAI_API_KEY: "xai-key",
    XAI_BASE_URL: "https://api.x.ai/v1",
    XAI_MODEL: "grok-4.3",
  }, () => {
    const configs = getSlackCopyProviderFallbackConfigs();
    assert.equal(configs[0]?.provider, "moonshot");
    assert.equal(configs[0]?.model, "kimi-k2.6");
    assert.equal(configs[1]?.provider, "xai");
    assert.equal(configs[1]?.model, "grok-4.3");
  });

  const originalFetch = globalThis.fetch;
  try {
    let requestBodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ ok: true, source: "message-content" }) }, reasoning_content: "ignore this" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const provider = new OpenAiCompatibleProvider({
      enabled: true,
      provider: "lmstudio",
      apiKey: "lm-studio",
      model: "qwen/qwen3.5-9b",
      baseUrl: "http://localhost:1234/v1",
    });
    const result = await provider.completeJson<{ ok: boolean; source: string }>({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(result.ok, true);
    assert.equal(result.data?.ok, true);
    assert.equal(result.data?.source, "message-content");
    assert.deepEqual(requestBodies.map((body) => Boolean(body.response_format)), [true]);

    requestBodies = [];
    const kimiProvider = new OpenAiCompatibleProvider({
      enabled: true,
      provider: "moonshot",
      apiKey: "moonshot-key",
      model: "kimi-k2.6",
      baseUrl: "https://api.moonshot.ai/v1",
    });
    const kimiResult = await kimiProvider.completeJson<{ ok: boolean; source: string }>({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(kimiResult.ok, true);
    assert.equal(kimiResult.data?.source, "message-content");
    assert.deepEqual(requestBodies[0].thinking, { type: "disabled" });
    assert.equal(requestBodies[0].temperature, 0.6);
    assert.equal((requestBodies[0].messages as Array<{ content: string }>)[0].content.includes("/no_think"), false);

    requestBodies = [];
    globalThis.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ error: { message: "response_format unsupported" } }), { status: 400 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ok: true, source: "fallback-no-response-format" }) } }],
      }), { status: 200 });
    };
    const fallback = await provider.completeJson<{ ok: boolean; source: string }>({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(fallback.ok, true);
    assert.equal(fallback.data?.source, "fallback-no-response-format");
    assert.deepEqual(requestBodies.map((body) => Boolean(body.response_format)), [true, false]);
    assert.equal((requestBodies[0].messages as Array<{ content: string }>)[0].content.includes("/no_think"), true);

    requestBodies = [];
    globalThis.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      if (requestBodies.length === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ ok: true, source: "empty-content-retry" }) } }],
      }), { status: 200 });
    };
    const emptyContentRetry = await provider.completeJson<{ ok: boolean; source: string }>({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(emptyContentRetry.ok, true);
    assert.equal(emptyContentRetry.data?.source, "empty-content-retry");
    assert.deepEqual(requestBodies.map((body) => Boolean(body.response_format)), [true, false]);

    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Sure:\n```json\n{\"ok\":true,\"source\":\"fenced-json\"}\n```" } }],
    }), { status: 200 });
    const fenced = await provider.completeJson<{ ok: boolean; source: string }>({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(fenced.ok, true);
    assert.equal(fenced.data?.source, "fenced-json");

    globalThis.fetch = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:1234"); };
    const offline = await provider.completeJson({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(offline.ok, false);

    const plainProposal = [
      "Steve here.",
      "Your Shopify store already has traction, and the branding brief points to trust, offer clarity, and product-path friction.",
      "I would start with a 3-5 day diagnostic. Done = identity risks, buying path friction, and first design direction mapped.",
      "If useful, would you rather see the first async outline here, or do a quick call?",
    ].join("\n\n");
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: plainProposal } }] }), { status: 200 });
    const plainTextFallback = await provider.completeJson<{ proposalText: string }>({
      messages: [{ role: "user", content: "hi" }],
      plainTextFallbackKey: "proposalText",
    });
    assert.equal(plainTextFallback.ok, true);
    assert.equal(plainTextFallback.data?.proposalText, plainProposal);

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 });
    const invalid = await provider.completeJson({ messages: [{ role: "user", content: "hi" }] });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error ?? "", /Unexpected token|JSON/i);
  } finally {
    globalThis.fetch = originalFetch;
  }

  withEnv({
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: "",
    OPENROUTER_MODEL: "openai/gpt-4.1-mini",
  }, () => {
    const provider = new OpenAiCompatibleProvider({ enabled: true, provider: "openrouter", apiKey: "", model: "x", baseUrl: "https://openrouter.ai/api/v1" });
    assert.equal(provider.isAvailable(), false);
  });

  console.log("llm provider tests passed");
}

run().catch((error) => {
  console.error(`llm provider tests failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
