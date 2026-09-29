import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";

/**
 * Which git repo holds the agent files.
 *
 * The outer repo ignores agents/ (a clone gets the app, never the crew), so
 * commits of agent files must land in a nested repo at agents/.git — local,
 * never pushed. Everything that commits or reads agent history goes through
 * this one function; before the nested repo exists it falls back to the outer
 * root, which is how the code worked until 2026-09-22.
 */
export function agentsRepoRoot(): string {
  return existsSync(join(config.agentsDir, ".git")) ? config.agentsDir : config.root;
}
