import type { Agent, CheckResult, CheckVerdict, DoneCheck, Goal, StepStatus, Verification } from "./types.ts";

/**
 * The goal contract and the evidence gate.
 *
 * WHY THIS EXISTS
 * A goal used to be a title and a list of steps, and a step was "done" the
 * moment the orchestrator said so. That is the false green the house rules
 * warn about, enforced by nothing. Three things change here, all pure so they
 * can be tested without a driver:
 *
 *   1. A goal carries a CONTRACT: `doneWhen` conditions, each with how it will
 *      be shown, plus constraints and the actions that need Dominic first.
 *   2. A step reported `done` without evidence is not done. It stays active and
 *      the room is told, so the board never records a claim as a fact.
 *   3. Before a goal closes as done, a VERIFIER — an agent who did not build
 *      it — answers each condition with pass, fail or unverified, citing what
 *      it saw. The receipt Dominic reads is built from those verdicts, not from
 *      the last thing an agent said.
 *
 * Nothing here talks to a model or the database. The orchestrator calls in,
 * `db.ts` stores what comes out.
 */

export const CONTRACT_LIMITS = { checks: 5, constraints: 5, approvals: 5, text: 240, evidence: 400 } as const;

function oneLine(v: unknown, maxLen: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, maxLen) : "";
}

function cleanList(raw: unknown, cap: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = oneLine(item, maxLen);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= cap) break;
  }
  return out;
}

/** What the planner returned for the contract, made safe to store. */
export function normalizeContract(
  raw: { doneWhen?: unknown; constraints?: unknown; approvals?: unknown } | null | undefined,
): { doneWhen: DoneCheck[]; constraints: string[]; approvals: string[] } {
  const doneWhen: DoneCheck[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw?.doneWhen)) {
    for (const item of raw.doneWhen as unknown[]) {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const text = oneLine(o["text"], CONTRACT_LIMITS.text);
      const how = oneLine(o["how"], CONTRACT_LIMITS.text);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      doneWhen.push({ text, how: how || "(how it will be shown was not stated)" });
      if (doneWhen.length >= CONTRACT_LIMITS.checks) break;
    }
  }
  return {
    doneWhen,
    constraints: cleanList(raw?.constraints, CONTRACT_LIMITS.constraints, CONTRACT_LIMITS.text),
    approvals: cleanList(raw?.approvals, CONTRACT_LIMITS.approvals, CONTRACT_LIMITS.text),
  };
}

export interface StepReport {
  index: number;
  status: StepStatus;
  note: string | null;
  evidence?: string | null;
}

/** Evidence must be more than a word: a command, a seq, a file, a number. */
const MIN_EVIDENCE_CHARS = 8;

/**
 * The evidence gate. A `done` with nothing behind it becomes `active` with a
 * note saying why, so the board shows the step as still open and the room
 * sees the refusal in the transcript.
 */
export function gateStepReports(
  reported: StepReport[] | null | undefined,
): { accepted: StepReport[]; refused: StepReport[] } {
  const accepted: StepReport[] = [];
  const refused: StepReport[] = [];
  for (const r of reported ?? []) {
    const evidence = oneLine(r.evidence, CONTRACT_LIMITS.evidence);
    if (r.status === "done" && evidence.length < MIN_EVIDENCE_CHARS) {
      refused.push({
        index: r.index,
        status: "active",
        note: "reported done without evidence — still open",
        evidence: null,
      });
      continue;
    }
    accepted.push({ index: r.index, status: r.status, note: r.note ?? null, evidence: evidence || null });
  }
  return { accepted, refused };
}

const VERDICTS: readonly CheckVerdict[] = ["pass", "fail", "unverified"];

/** Every condition present and passed. No contract (old goals) passes by definition. */
export function verificationPassed(checks: CheckResult[], expected: number): boolean {
  if (expected <= 0) return true;
  for (let i = 0; i < expected; i++) {
    const c = checks.find((x) => x.index === i);
    if (!c || c.verdict !== "pass") return false;
  }
  return true;
}

/** What the verifier returned, one entry per contract condition, made safe to store. */
export function normalizeVerification(
  raw: { checks?: unknown; risks?: unknown; approvals?: unknown } | null | undefined,
  expected: number,
  verifierId: string,
  at = Date.now(),
): Verification {
  const given = Array.isArray(raw?.checks) ? (raw.checks as unknown[]) : [];
  const checks: CheckResult[] = [];
  for (let i = 0; i < expected; i++) {
    const found = given.find(
      (c) => c && typeof c === "object" && Number((c as Record<string, unknown>)["index"]) === i,
    ) as Record<string, unknown> | undefined;
    const verdictRaw = oneLine(found?.["verdict"], 20).toLowerCase() as CheckVerdict;
    const verdict: CheckVerdict = VERDICTS.includes(verdictRaw) ? verdictRaw : "unverified";
    const evidence = oneLine(found?.["evidence"], CONTRACT_LIMITS.evidence);
    checks.push({
      index: i,
      verdict,
      evidence: evidence || (found ? "" : "(the verifier gave no verdict for this condition)"),
    });
  }
  return {
    verifierId,
    at,
    passed: verificationPassed(checks, expected),
    checks,
    risks: cleanList(raw?.risks, CONTRACT_LIMITS.approvals, CONTRACT_LIMITS.text),
    approvals: cleanList(raw?.approvals, CONTRACT_LIMITS.approvals, CONTRACT_LIMITS.text),
  };
}

const VERIFIER_WORDS = /\b(critic|review|verif|qa|audit|test|check)/i;

/**
 * Who checks the work: never the orchestrator that planned it, and by
 * preference someone who did not build it. A critic-shaped role wins; failing
 * that, any member who owned no step; failing that, null and the caller uses
 * the orchestrator with a fresh, adversarial prompt.
 */
export function pickVerifier(roster: Agent[], orchestratorId: string, builders: ReadonlySet<string>): Agent | null {
  const candidates = roster.filter((a) => a.id !== orchestratorId);
  const critics = candidates.filter((a) => VERIFIER_WORDS.test(`${a.role} ${a.name} ${a.description}`));
  return (
    critics.find((a) => !builders.has(a.id)) ??
    critics[0] ??
    candidates.find((a) => !builders.has(a.id)) ??
    null
  );
}

type ContractGoal = Pick<Goal, "title" | "doneWhen" | "constraints" | "approvals" | "verification">;

/** The contract as the room reads it in a prompt. Empty string when the goal has none. */
export function contractText(goal: ContractGoal): string {
  if (goal.doneWhen.length === 0 && goal.constraints.length === 0 && goal.approvals.length === 0) return "";
  const lines: string[] = [];
  if (goal.doneWhen.length) {
    lines.push(`Done when — ALL of these hold, each shown the way it says:`);
    goal.doneWhen.forEach((c, i) => {
      const r = goal.verification?.checks.find((x) => x.index === i);
      const mark = r ? (r.verdict === "pass" ? "[pass]" : r.verdict === "fail" ? "[FAIL]" : "[unverified]") : "[ ]";
      const verifierNote = r && r.verdict !== "pass" && r.evidence ? ` — verifier: ${r.evidence}` : "";
      lines.push(`  ${mark} ${i + 1}. ${c.text} — shown by: ${c.how}${verifierNote}`);
    });
  }
  if (goal.constraints.length) {
    lines.push(`Constraints — the room must not:`);
    for (const c of goal.constraints) lines.push(`  - ${c}`);
  }
  if (goal.approvals.length) {
    lines.push(`Needs Dominic's go BEFORE it happens:`);
    for (const a of goal.approvals) lines.push(`  - ${a}`);
  }
  if (goal.verification && !goal.verification.passed) {
    lines.push(`The last verification did not pass. Work on the conditions marked FAIL or unverified, with evidence.`);
  }
  return lines.join("\n");
}

/**
 * The part of the run receipt the harness can vouch for: what the verifier
 * passed, what it could not, the risks it named, and what still needs a go.
 * Empty when the goal had no contract, so old goals report as they always did.
 */
export function receiptSections(goal: ContractGoal): string[] {
  if (goal.doneWhen.length === 0) return [];
  const v = goal.verification;
  const lines: string[] = [""];
  if (!v) {
    lines.push("📋 *Done when* — the run ended before a verifier checked these:");
    goal.doneWhen.forEach((c, i) => lines.push(`   ${i + 1}. ${c.text}`));
    if (goal.approvals.length) {
      lines.push("", "🔐 *Needs your go:*");
      for (const a of goal.approvals) lines.push(`   · ${a}`);
    }
    return lines;
  }
  const passed = v.checks.filter((c) => c.verdict === "pass");
  const failed = v.checks.filter((c) => c.verdict !== "pass");
  const name = (c: CheckResult): string => goal.doneWhen[c.index]?.text ?? `condition ${c.index + 1}`;
  lines.push(`🧾 *Receipt* — ${passed.length} of ${goal.doneWhen.length} conditions verified`);
  if (passed.length) {
    lines.push("✅ *Verified:*");
    for (const c of passed) lines.push(`   · ${name(c)}${c.evidence ? ` — ${c.evidence}` : ""}`);
  }
  if (failed.length) {
    lines.push("❌ *Not verified:*");
    for (const c of failed) {
      const label = c.verdict === "fail" ? "failed" : "unverified";
      lines.push(`   · ${name(c)} — ${label}${c.evidence ? `: ${c.evidence}` : ""}`);
    }
  }
  if (v.risks.length) {
    lines.push("⚠️ *Risks:*");
    for (const r of v.risks) lines.push(`   · ${r}`);
  }
  const approvals = [...new Set([...goal.approvals, ...v.approvals])];
  if (approvals.length) {
    lines.push("🔐 *Needs your go:*");
    for (const a of approvals) lines.push(`   · ${a}`);
  }
  return lines;
}
