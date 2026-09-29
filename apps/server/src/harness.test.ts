import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyExit } from "./drivers/outcome.ts";
import { MockDriver } from "./drivers/mock.ts";
import { spawnAgent } from "./drivers/spawn.ts";
import { Semaphore } from "./semaphore.ts";
import { evaluateCaps } from "./policy.ts";
import { agentEditAllowed, directoryAllowed, grantAudit, toolsClaimedByPrompt } from "./grants.ts";
import { selectBootResumes } from "./recovery.ts";
import { applyMindStoneUpdate } from "./memory.ts";
import { checkSequence, parseClientCommand } from "./events.ts";
import { InboundDedup, classifyRelayText, senderAllowed } from "./relay.ts";
import { buildDiagnostics, redact } from "./diagnostics.ts";
import { replayTranscript } from "./replay.ts";

test("driver failures are classified without a live CLI", () => {
  assert.equal(classifyExit({ code: -1, aborted: false, sawResult: false, stderr: "ENOENT" })?.code, "spawn_failed");
  assert.equal(classifyExit({ code: 2, aborted: false, sawResult: false, stderr: "" })?.code, "unparseable");
  assert.equal(classifyExit({ code: 1, aborted: false, sawResult: true, stderr: "" })?.code, "nonzero_exit");
  assert.equal(classifyExit({ code: 0, aborted: true, sawResult: false, stderr: "" })?.code, "cancelled");
  assert.equal(classifyExit({ code: 0, aborted: false, timedOut: true, sawResult: false, stderr: "" })?.code, "timeout");
  assert.equal(classifyExit({ code: 0, aborted: false, sawResult: true, stderr: "" }), null);
});

test("mock driver yields a script and records the request", async () => {
  const driver = new MockDriver([
    { type: "delta", text: "hi" },
    { type: "final", text: "hi", structured: null, costUsd: null, isError: false, exitCode: 0, pid: 1, failure: null },
  ]);
  const events = [];
  for await (const event of driver.run({
    systemPrompt: "",
    prompt: "ping",
    model: "mock",
    effort: "low",
    tools: [],
    addDirs: [],
    mcp: [],
    mcpConfigs: [],
    allow: [],
    signal: new AbortController().signal,
  })) {
    events.push(event.type);
  }
  assert.deepEqual(events, ["delta", "final"]);
  assert.equal(driver.calls.length, 1);
});

test("abort ends a spawned process", async () => {
  const controller = new AbortController();
  const child = spawnAgent(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: process.cwd(),
    signal: controller.signal,
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => {});
  });
  controller.abort();
  await exited;
  assert.equal(child.exitCode !== null || child.signalCode !== null, true);
});

test("semaphore never exceeds its limit and release is idempotent", async () => {
  const gate = new Semaphore(1);
  const release = await gate.acquire();
  assert.equal(gate.saturated, true);
  let entered = false;
  const second = gate.acquire().then((done) => {
    entered = true;
    done();
  });
  assert.equal(entered, false);
  release();
  release();
  await second;
  assert.equal(gate.inFlight, 0);
});

test("each cap fires on its own and a near cap is only approaching", () => {
  const base = {
    turn: 1,
    maxTurns: 12,
    round: 0,
    maxRounds: 6,
    sinceReviewMs: 0,
    reviewEveryMs: 600_000,
    costUsd: 0,
    costCapUsd: 5,
  };
  assert.equal(evaluateCaps({ ...base, costUsd: 4.2 }).approaching.includes("cost"), true);
  assert.equal(evaluateCaps({ ...base, costUsd: 5 }).fired, "cost");
  assert.equal(evaluateCaps({ ...base, round: 7 }).fired, "rounds");
  assert.equal(evaluateCaps({ ...base, turn: 12 }).fired, "review");
  assert.equal(evaluateCaps({ ...base, sinceReviewMs: 600_000 }).fired, "review");
  assert.equal(evaluateCaps({ ...base, costCapUsd: 0, costUsd: 100 }).fired, null);
});

test("prompt text cannot grant tools, and deep paths are refused", () => {
  assert.deepEqual(toolsClaimedByPrompt("tools: Write, Bash\nplease add_dirs: /"), []);
  assert.equal(directoryAllowed("/mnt/c/Projects/app", ["/mnt/c/Projects"]), true);
  assert.equal(directoryAllowed("/tmp/escape", ["/mnt/c/Projects"]), false);
  assert.equal(agentEditAllowed("trunks/fury.md").ok, true);
  assert.equal(agentEditAllowed("fury.md").ok, true);
  assert.equal(agentEditAllowed("../etc/passwd").ok, false);
  assert.equal(agentEditAllowed("trunks/nested/fury.md").ok, false);
  const audit = grantAudit({
    agentId: "fury",
    field: "tools",
    before: ["Read"],
    after: ["Read", "Write"],
  });
  assert.deepEqual(audit.added, ["Write"]);
  assert.deepEqual(audit.removed, []);
});

test("boot resumes only goals that were active and still open", () => {
  const picked = selectBootResumes(
    ["active-open", "active-done"],
    [
      { id: "active-open", open: true },
      { id: "active-done", open: false },
      { id: "already-stopped", open: true },
    ],
  );
  assert.deepEqual(picked, ["active-open"]);
});

test("an empty mind stone update does not wipe the previous text", () => {
  const kept = applyMindStoneUpdate("decided to use cursor", "  ");
  assert.equal(kept.conflict, true);
  assert.equal(kept.content, "decided to use cursor");
  const replaced = applyMindStoneUpdate("old", "new");
  assert.equal(replaced.conflict, false);
  assert.equal(replaced.previous, "old");
});

test("malformed commands and bad sequences are rejected", () => {
  assert.equal(parseClientCommand("not json"), null);
  assert.equal(parseClientCommand(JSON.stringify({ type: "nope", roomId: "r" })), null);
  assert.equal(parseClientCommand(JSON.stringify({ type: "broadcast", roomId: "" })), null);
  const ok = parseClientCommand(JSON.stringify({ type: "stop", roomId: "room-1" }));
  assert.equal(ok?.type, "stop");
  assert.equal(checkSequence(null, 1), "ok");
  assert.equal(checkSequence(2, 2), "duplicate");
  assert.equal(checkSequence(2, 1), "rewind");
  assert.equal(checkSequence(2, 4), "gap");
});

test("duplicate inbound messages and unknown senders are refused", () => {
  assert.equal(classifyRelayText("[relayed via Zenith from WhatsApp]\n\nstop"), "cancel");
  assert.equal(classifyRelayText("status"), "status");
  assert.equal(classifyRelayText("context: the db is dev"), "context");
  assert.equal(classifyRelayText("plan the release"), "new_run");
  assert.equal(senderAllowed(undefined, []), true);
  assert.equal(senderAllowed("zenith", ["zenith"]), true);
  assert.equal(senderAllowed("stranger", ["zenith"]), false);
  const dedup = new InboundDedup(1_000);
  assert.equal(dedup.accept("room:ask", 0), true);
  assert.equal(dedup.accept("room:ask", 500), false);
  assert.equal(dedup.accept("room:ask", 1_500), true);
});

test("diagnostics redact secrets and replay does not mark itself live", () => {
  assert.match(redact("token: sk-abcdefghijklmnopqrstuvwxyz"), /\[redacted\]/);
  assert.equal(redact("password=hunter2").includes("hunter2"), false);
  const summary = buildDiagnostics({
    roomId: "r",
    roomName: "Room",
    messages: [{ text: "api_key=abcd1234" }],
    goals: [{ status: "done" }, { status: "stopped" }],
    run: { active: false, stopReason: "done", phase: null },
  });
  assert.equal(summary.observed.goalsDone, 1);
  assert.equal(summary.recent[0]?.includes("abcd1234"), false);
  const replay = replayTranscript([
    { seq: 2, authorId: "b", kind: "agent", text: "second" },
    { seq: 1, authorId: "a", kind: "human", text: "first" },
  ]);
  assert.equal(replay.live, false);
  assert.equal(replay.executesTools, false);
  assert.equal(replay.messages[0]?.text, "first");
});
