#!/usr/bin/env node

/**
 * AI School Production Readiness Smoke Test Suite
 * 
 * Run with: node scripts/smoke-test.mjs
 */

const BASE_URL = process.env.SMOKE_TEST_URL || "http://localhost:3000";

console.log(`
╔════════════════════════════════════════════════════════════╗
║         AI School Production Readiness Smoke Suite        ║
╚════════════════════════════════════════════════════════════╝
`);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const testName = name.padEnd(50);
  process.stdout.write(`\n  ${"█".repeat(50)}\n  ${testName} `);
  
  try {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    console.log(`\x1b[32m✓ PASS\x1b[0m (${duration}ms)`);
    passed++;
  } catch (error) {
    console.log(`\x1b[31m✗ FAIL\x1b[0m - ${error.message}`);
    failed++;
  }
}

async function fetchJSON(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function runSmokeTests() {
  console.log("\n\x1b[1mPhase 0: Infrastructure\x1b[0m");
  
  await test("Dev server responds", async () => {
    const { status } = await fetchJSON("/api/bootstrap");
    if (status !== 200) throw new Error(`Server returned ${status}, expected 200`);
  });

  console.log("\n\x1b[1mPhase 1: Core Endpoints\x1b[0m");

  await test("GET /api/models returns catalog", async () => {
    const { status, data } = await fetchJSON("/api/models");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!Array.isArray(data?.models)) throw new Error("No models array");
    console.log(`   Found ${data.models.length} models`);
  });

  await test("GET /api/packs returns list", async () => {
    const { status, data } = await fetchJSON("/api/packs");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!Array.isArray(data?.packs)) throw new Error("No packs array");
  });

  await test("GET /api/agents returns list", async () => {
    const { status, data } = await fetchJSON("/api/agents");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!Array.isArray(data?.agents)) throw new Error("No agents array");
  });

  console.log("\n\x1b[1mPhase 2: Chat Operations\x1b[0m");

  await test("POST /api/chats (tutor mode)", async () => {
    const { status } = await fetchJSON("/api/chats", {
      method: "POST",
      body: JSON.stringify({
        packId: "test-pack-id",
        mode: "tutor",
        thinkingLevel: "medium",
        routerMode: "auto",
        usePersonalResources: true,
      }),
    });
    if (status !== 200 && status !== 400) throw new Error(`Status ${status}`);
  });

  await test("POST /api/chats (all 9 modes)", async () => {
    const modes = ["tutor", "marker", "exam", "draft_coach", "quiz", "flashcard", "research", "explain", "general"];
    for (const mode of modes) {
      const { status } = await fetchJSON("/api/chats", {
        method: "POST",
        body: JSON.stringify({
          packId: "test-pack-id",
          mode,
          thinkingLevel: "medium",
          routerMode: "auto",
          usePersonalResources: true,
        }),
      });
      if (status !== 200 && status !== 400) throw new Error(`Mode '${mode}' failed: ${status}`);
    }
    console.log(`   All 9 modes validated`);
  });

  await test("POST /api/chats invalid mode", async () => {
    const { status, data } = await fetchJSON("/api/chats", {
      method: "POST",
      body: JSON.stringify({
        packId: "test-pack-id",
        mode: "invalid_mode_xyz",
        thinkingLevel: "medium",
        routerMode: "auto",
      }),
    });
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
    if (!data?.error?.code) throw new Error("Error missing code");
    console.log(`   Error code: ${data?.error?.code}`);
  });

  await test("GET /api/chats returns list", async () => {
    const { status, data } = await fetchJSON("/api/chats");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!Array.isArray(data?.chats)) throw new Error("No chats array");
  });

  console.log("\n\x1b[1mPhase 3: Prompt Enhancement\x1b[0m");

  await test("POST /api/enhance-prompt (local)", async () => {
    const { status, data } = await fetchJSON("/api/enhance-prompt", {
      method: "POST",
      body: JSON.stringify({
        message: "Explain photosynthesis",
        mode: "tutor",
        subject: "Biology",
        enableAI: false,
      }),
    });
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data?.enhanced) throw new Error("No enhanced prompt");
    if (data.enhanced === "Explain photosynthesis") throw new Error("Enhancement is identity");
  });

  await test("POST /api/enhance-prompt invalid mode", async () => {
    const { status } = await fetchJSON("/api/enhance-prompt", {
      method: "POST",
      body: JSON.stringify({
        message: "Test",
        mode: "not_a_real_mode",
        subject: "General",
        enableAI: false,
      }),
    });
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  });

  console.log("\n\x1b[1mPhase 4: Analytics\x1b[0m");

  await test("GET /api/analytics returns data", async () => {
    const { status, data } = await fetchJSON("/api/analytics");
    if (status !== 200) throw new Error(`Status ${status}`);
    if (!data?.daily) throw new Error("No daily stats");
  });

  console.log("\n\x1b[1mPhase 5: Error Handling\x1b[0m");

  await test("400 error includes requestId", async () => {
    const { data } = await fetchJSON("/api/chats", {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!data?.error?.requestId) throw new Error("Error missing requestId");
    console.log(`   requestId: ${data?.error?.requestId}`);
  });

  await test("Unknown route returns 404", async () => {
    const { status } = await fetchJSON("/api/unknown-endpoint-xyz");
    if (status !== 404) throw new Error(`Expected 404, got ${status}`);
  });

  console.log("\n" + "=".repeat(60));
  console.log("\x1b[1mResults\x1b[0m");
  console.log("=".repeat(60));
  console.log(`\x1b[32m  Passed: ${passed}\x1b[0m`);
  console.log(`\x1b[31m  Failed: ${failed}\x1b[0m`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\n\x1b[31mSome tests failed!\x1b[0m\n");
    process.exit(1);
  }

  console.log("\n\x1b[32m✓ All smoke tests passed!\x1b[0m\n");
  process.exit(0);
}

runSmokeTests().catch((error) => {
  console.error("\nSmoke test failed:", error);
  process.exit(1);
});
