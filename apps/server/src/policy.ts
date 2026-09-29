/**
 * Cap checks. The numbers still come from config. This module only decides
 * whether a cap is near or has fired, so the loop and the tests share one rule.
 */

export interface CapInput {
  turn: number;
  maxTurns: number;
  round: number;
  maxRounds: number;
  sinceReviewMs: number;
  reviewEveryMs: number;
  costUsd: number;
  costCapUsd: number;
}

export interface CapShot {
  /** Caps at or past 80% of their budget. A zero cap is off, never approaching. */
  approaching: Array<"turns" | "rounds" | "cost">;
  fired: "cost" | "rounds" | "review" | null;
}

export function evaluateCaps(input: CapInput): CapShot {
  const approaching: CapShot["approaching"] = [];
  if (input.maxTurns > 0 && input.turn >= input.maxTurns * 0.8 && input.turn < input.maxTurns) {
    approaching.push("turns");
  }
  if (input.maxRounds > 0 && input.round >= input.maxRounds * 0.8 && input.round < input.maxRounds) {
    approaching.push("rounds");
  }
  if (input.costCapUsd > 0 && input.costUsd >= input.costCapUsd * 0.8 && input.costUsd < input.costCapUsd) {
    approaching.push("cost");
  }

  if (input.costCapUsd > 0 && input.costUsd >= input.costCapUsd) return { approaching, fired: "cost" };
  if (input.round > input.maxRounds) return { approaching, fired: "rounds" };
  if (input.turn >= input.maxTurns || input.sinceReviewMs >= input.reviewEveryMs) {
    return { approaching, fired: "review" };
  }
  return { approaching, fired: null };
}
