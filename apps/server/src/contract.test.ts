import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contractText,
  gateStepReports,
  normalizeContract,
  normalizeVerification,
  pickVerifier,
  receiptSections,
  verificationPassed,
} from "./contract.ts";
import type { Agent } from "./types.ts";

function agent(id: string, role: string, description = ""): Agent {
  return {
    id,
    name: id,
    role,
    description,
    instructions: "",
    personality: "",
    color: "#000",
    model: "m",
    effort: "low",
    orchestrator: false,
    tools: [],
    addDirs: [],
    mcp: [],
    allow: [],
    forgedBy: null,
  } as unknown as Agent;
}

test("a contract is trimmed, de-duplicated and capped", () => {
  const c = normalizeContract({
    doneWhen: [
      { text: "  tests pass ", how: "pnpm test prints 0 fail" },
      { text: "Tests pass", how: "again" },
      { text: "", how: "x" },
      { text: "page renders", how: "" },
      { text: "a" },
      { text: "b" },
      { text: "c" },
      { text: "d" },
    ],
    constraints: ["no schema change", "no schema change", 42],
    approvals: ["push to production"],
  });
  assert.equal(c.doneWhen.length, 5);
  assert.equal(c.doneWhen[0]?.text, "tests pass");
  assert.equal(c.doneWhen[1]?.text, "page renders");
  assert.match(c.doneWhen[1]?.how ?? "", /not stated/);
  assert.deepEqual(c.constraints, ["no schema change"]);
  assert.deepEqual(c.approvals, ["push to production"]);
  assert.deepEqual(normalizeContract(null), { doneWhen: [], constraints: [], approvals: [] });
});

test("done without evidence is refused and stays active", () => {
  const { accepted, refused } = gateStepReports([
    { index: 0, status: "done", note: null, evidence: "pnpm test → 19 pass, 0 fail [#412]" },
    { index: 1, status: "done", note: "finished", evidence: "" },
    { index: 2, status: "done", note: null, evidence: "ok" },
    { index: 3, status: "blocked", note: "needs the GPU", evidence: null },
  ]);
  assert.deepEqual(
    accepted.map((r) => [r.index, r.status]),
    [
      [0, "done"],
      [3, "blocked"],
    ],
  );
  assert.deepEqual(
    refused.map((r) => [r.index, r.status]),
    [
      [1, "active"],
      [2, "active"],
    ],
  );
  assert.match(refused[0]?.note ?? "", /without evidence/);
  assert.deepEqual(gateStepReports(null), { accepted: [], refused: [] });
});

test("verification passes only when every condition passed", () => {
  assert.equal(verificationPassed([], 0), true);
  assert.equal(verificationPassed([{ index: 0, verdict: "pass", evidence: "x" }], 2), false);
  assert.equal(
    verificationPassed(
      [
        { index: 0, verdict: "pass", evidence: "x" },
        { index: 1, verdict: "unverified", evidence: "" },
      ],
      2,
    ),
    false,
  );
  assert.equal(
    verificationPassed(
      [
        { index: 1, verdict: "pass", evidence: "y" },
        { index: 0, verdict: "pass", evidence: "x" },
      ],
      2,
    ),
    true,
  );
});

test("a verifier's answer is normalized to one verdict per condition", () => {
  const v = normalizeVerification(
    {
      checks: [
        { index: 1, verdict: "PASS", evidence: "saw it at [#12]" },
        { index: 0, verdict: "maybe", evidence: "" },
      ],
      risks: ["mobile untested"],
      approvals: ["deploy"],
    },
    3,
    "critic",
    1000,
  );
  assert.equal(v.verifierId, "critic");
  assert.equal(v.at, 1000);
  assert.equal(v.passed, false);
  assert.deepEqual(
    v.checks.map((c) => [c.index, c.verdict]),
    [
      [0, "unverified"],
      [1, "pass"],
      [2, "unverified"],
    ],
  );
  assert.match(v.checks[2]?.evidence ?? "", /no verdict/);
  assert.deepEqual(v.risks, ["mobile untested"]);
  assert.deepEqual(v.approvals, ["deploy"]);
});

test("the verifier is a critic who did not build it, never the orchestrator", () => {
  const roster = [
    agent("boss", "Orchestrator"),
    agent("dev", "Developer"),
    agent("rene", "RAG Critic"),
    agent("scout", "Researcher"),
  ];
  assert.equal(pickVerifier(roster, "boss", new Set(["dev"]))?.id, "rene");
  assert.equal(pickVerifier(roster, "boss", new Set(["dev", "rene"]))?.id, "rene");
  assert.equal(pickVerifier([roster[0]!, roster[1]!, roster[3]!], "boss", new Set(["dev"]))?.id, "scout");
  assert.equal(pickVerifier([roster[0]!], "boss", new Set()), null);
});

test("the contract text and the receipt come from verdicts, not prose", () => {
  const goal = {
    title: "Fix the coupon bug",
    doneWhen: [
      { text: "duplicate coupon is refused", how: "regression test passes" },
      { text: "checkout total is right", how: "browser flow screenshot" },
    ],
    constraints: ["no schema change"],
    approvals: ["deploy to staging"],
    verification: null,
  };
  assert.match(contractText(goal), /\[ \] 1\. duplicate coupon is refused — shown by: regression test passes/);
  assert.match(contractText(goal), /Needs Dominic's go BEFORE/);
  assert.match(receiptSections(goal).join("\n"), /run ended before a verifier/);

  const verified = {
    ...goal,
    verification: normalizeVerification(
      {
        checks: [
          { index: 0, verdict: "pass", evidence: "test at [#9] prints 1 passed" },
          { index: 1, verdict: "fail", evidence: "no screenshot in the room" },
        ],
        risks: ["legacy client"],
        approvals: ["deploy to staging", "notify the client"],
      },
      2,
      "rene",
    ),
  };
  const receipt = receiptSections(verified).join("\n");
  assert.match(receipt, /1 of 2 conditions verified/);
  assert.match(receipt, /✅ \*Verified:\*\n   · duplicate coupon is refused — test at \[#9\]/);
  assert.match(receipt, /❌ \*Not verified:\*\n   · checkout total is right — failed: no screenshot/);
  assert.match(receipt, /⚠️ \*Risks:\*\n   · legacy client/);
  assert.match(receipt, /🔐 \*Needs your go:\*\n   · deploy to staging\n   · notify the client/);
  assert.match(contractText(verified), /\[FAIL\] 2\./);
  assert.match(contractText(verified), /did not pass/);
  assert.deepEqual(receiptSections({ ...goal, doneWhen: [] }), []);
});
