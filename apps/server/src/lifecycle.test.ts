import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEGACY_STOP_REASONS,
  transitionPhase,
  transitionTerminal,
  type LiveStatus,
} from "./lifecycle.ts";

const LIVE: LiveStatus[] = [
  "queued",
  "planning",
  "deciding",
  "waiting_slot",
  "generating",
  "rate_limited",
  "reviewing",
  "compacting",
];

test("every live phase may move to every other live phase", () => {
  for (const from of LIVE) {
    for (const to of LIVE) {
      const result = transitionPhase(from, to);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.duplicate, from === to);
    }
  }
});

test("a finished run cannot go back to a live phase", () => {
  const result = transitionPhase("completed", "planning");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /finished/);
});

test("legacy stop reasons map to distinct terminal kinds", () => {
  const kinds = LEGACY_STOP_REASONS.map((reason) => {
    const result = transitionTerminal("planning", reason);
    assert.equal(result.ok, true);
    if (!result.ok || !result.terminal) throw new Error(reason);
    assert.equal(result.terminal.stopReason, reason);
    return `${reason}:${result.terminal.kind}:${result.terminal.status}`;
  });
  assert.deepEqual(kinds, [
    "done:completed:completed",
    "stopped:user_cancelled:cancelled",
    "timeout:timeout:timed_out",
    "paused:cap:paused",
    "awaiting_access:awaiting_access:awaiting_access",
    "blocked:model_blocked:blocked",
    "turn_cap:cap:capped",
    "orchestrator_error:driver_failure:failed",
    "error:unhandled:failed",
  ]);
});

test("cost pause and review ceiling are caps, not failures", () => {
  const cost = transitionTerminal("generating", "paused");
  const rounds = transitionTerminal("reviewing", "turn_cap");
  assert.equal(cost.ok && cost.terminal?.kind, "cap");
  assert.equal(cost.ok && cost.terminal?.cap, "cost");
  assert.equal(rounds.ok && rounds.terminal?.kind, "cap");
  assert.equal(rounds.ok && rounds.terminal?.cap, "rounds");
  assert.notEqual(cost.ok && cost.terminal?.status, "failed");
  assert.notEqual(rounds.ok && rounds.terminal?.status, "failed");
});

test("the first terminal reason is kept", () => {
  const first = transitionTerminal("deciding", "timeout");
  assert.equal(first.ok && first.terminal?.stopReason, "timeout");
  const second = transitionTerminal("timed_out", "stopped");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.duplicate, true);
    assert.equal(second.terminal, undefined);
    assert.equal(second.to, "timed_out");
  }
});

test("cancellation is idempotent", () => {
  const first = transitionTerminal("generating", "stopped");
  assert.equal(first.ok && first.duplicate, false);
  const second = transitionTerminal("cancelled", "stopped");
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.duplicate, true);
    assert.equal(second.to, "cancelled");
  }
});

test("a failed run cannot be marked completed", () => {
  for (const failed of ["error", "orchestrator_error"] as const) {
    const ended = transitionTerminal("generating", failed, "spawn failed");
    assert.equal(ended.ok && ended.terminal?.status, "failed");
    const completed = transitionTerminal("failed", "done");
    assert.equal(completed.ok, false);
    if (!completed.ok) assert.match(completed.reason, /cannot be marked completed/);
  }
});

test("queued work may start", () => {
  const plan = transitionPhase("queued", "planning");
  const direct = transitionPhase("queued", "generating");
  assert.equal(plan.ok && plan.duplicate, false);
  assert.equal(direct.ok && direct.duplicate, false);
});
