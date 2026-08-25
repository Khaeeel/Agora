import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import chokidar from "chokidar";
import { config } from "../config.ts";
import type { Agent } from "../types.ts";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Pull `## Heading` sections out of the markdown body. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = body.split(/^##\s+/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const heading = part.slice(0, nl).trim().toLowerCase();
    out.set(heading, part.slice(nl + 1).trim());
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export function parseAgentFile(path: string): Agent {
  const raw = readFileSync(path, "utf8");
  const id = basename(path, ".md").toLowerCase();

  let meta: Record<string, unknown> = {};
  let body = raw;
  const fm = raw.match(FRONTMATTER);
  if (fm?.[1]) {
    body = raw.slice(fm[0].length);
    const parsed: unknown = parseYaml(fm[1]);
    if (parsed && typeof parsed === "object") {
      meta = parsed as Record<string, unknown>;
    }
  }

  const s = sections(body);
  return {
    id,
    name: s.get("name") ?? id,
    role: s.get("role") ?? "Agent",
    description: s.get("description") ?? "",
    instructions: s.get("instructions") ?? "",
    personality: s.get("personality") ?? "",
    color: typeof meta["color"] === "string" ? meta["color"] : "#7A6A5D",
    model: typeof meta["model"] === "string" ? meta["model"] : config.model,
    effort: typeof meta["effort"] === "string" ? meta["effort"] : config.effort,
    tools: asStringArray(meta["tools"]),
    addDirs: asStringArray(meta["add_dirs"]),
    mcp: asStringArray(meta["mcp"]),
    orchestrator: meta["orchestrator"] === true,
    file: path,
  };
}

/**
 * Shared plumbing every agent loads — environment facts, standing rules, the
 * ticket format. Kept in one file so it cannot drift across six prompts.
 * Underscore-prefixed so it is never mistaken for an agent.
 */
export const HOUSE_RULES_FILE = "_house-rules.md";

export function loadHouseRules(): string {
  try {
    return readFileSync(join(config.agentsDir, HOUSE_RULES_FILE), "utf8").trim();
  } catch {
    return "";
  }
}

export function loadAgents(): Map<string, Agent> {
  const map = new Map<string, Agent>();
  let files: string[];
  try {
    files = readdirSync(config.agentsDir).filter(
      (f) => f.endsWith(".md") && !f.startsWith("_"),
    );
  } catch {
    return map;
  }
  for (const f of files.sort()) {
    try {
      const agent = parseAgentFile(join(config.agentsDir, f));
      map.set(agent.id, agent);
    } catch (err) {
      console.error(`[agents] failed to parse ${f}:`, err);
    }
  }
  return map;
}

/**
 * Render an agent back to the markdown format. The UI form and a hand-edited
 * file produce byte-identical output, so neither is the "real" one.
 */
export function renderAgentFile(a: {
  name: string;
  role: string;
  description: string;
  instructions: string;
  personality: string;
  color?: string;
  model?: string;
  effort?: string;
  orchestrator?: boolean;
  tools?: string[];
  addDirs?: string[];
}): string {
  const lines = [
    "---",
    `color: "${a.color ?? "#7A6A5D"}"`,
    `model: ${a.model ?? config.model}`,
    `effort: ${a.effort ?? config.effort}`,
  ];
  if (a.orchestrator) lines.push("orchestrator: true");
  // Round-trip tools rather than hardcoding []: an edit must not silently strip
  // a tool grant that was set by hand in the file.
  const tools = a.tools ?? [];
  lines.push(`tools: [${tools.map((t) => JSON.stringify(t)).join(", ")}]`);
  if (a.addDirs?.length) {
    lines.push(`add_dirs: [${a.addDirs.map((d) => JSON.stringify(d)).join(", ")}]`);
  }
  lines.push("---", "");
  lines.push(`# Agent: ${a.name}`, "");
  lines.push("## Name", a.name, "");
  lines.push("## Role", a.role, "");
  lines.push("## Description", a.description.trim(), "");
  lines.push("## Instructions", a.instructions.trim(), "");
  lines.push("## Personality", a.personality.trim(), "");
  return lines.join("\n");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Write an agent to disk.
 *
 * `existingId` pins the filename when editing, so renaming an agent updates its
 * file in place rather than orphaning the old one and silently creating a
 * second agent. Room membership is stored by id, so the id must stay stable.
 */
export function writeAgentFile(
  a: Parameters<typeof renderAgentFile>[0],
  existingId?: string,
): string {
  const id = existingId ?? slugify(a.name);
  if (!id) throw new Error("Agent name must contain at least one letter or number");
  const path = join(config.agentsDir, `${id}.md`);
  if (!existingId && existsSync(path)) {
    throw new Error(`An agent called "${id}" already exists`);
  }
  writeFileSync(path, renderAgentFile(a), "utf8");
  return id;
}

export function deleteAgentFile(id: string): void {
  const path = join(config.agentsDir, `${slugify(id)}.md`);
  if (!existsSync(path)) throw new Error(`No agent called "${id}"`);
  rmSync(path);
}

/**
 * Reload the roster whenever a .md changes on disk, so hand-editing a file and
 * using the Create Agent form are genuinely the same operation.
 */
export function watchAgents(onChange: (agents: Map<string, Agent>) => void): () => void {
  const watcher = chokidar.watch(config.agentsDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });
  const reload = () => onChange(loadAgents());
  watcher.on("add", reload).on("change", reload).on("unlink", reload);
  return () => void watcher.close();
}

/**
 * Login details and the hard limits for browser QA, injected from .env at
 * runtime. Deliberately NOT stored in any agent's .md — those files are read
 * into the UI and are safe to share; this block is not.
 */
function qaCredentials(): string {
  return [
    "",
    "## Signing in to the dev environment",
    "CHECK FIRST whether the browser is already signed in — Dominic often signs",
    "in by hand and the session persists. If you are already in, use that session.",
    "Do not sign out, and do not re-authenticate for the sake of it.",
    "",
    `Client app: ${config.qaBaseUrl}`,
    config.qaAdminUrl ? `Admin console: ${config.qaAdminUrl}` : "",
    `Email: ${config.qaEmail}`,
    `Password: ${config.qaPassword}`,
    "",
    "### Absolute limits on this account — no exceptions",
    `1. Use ONLY the "${config.qaAccount}" account. If the company picker shows`,
    "   others, do not open them. Not to look, not to compare. If you cannot find",
    `   "${config.qaAccount}", stop and say so — do not substitute another.`,
    "2. NEVER touch production: app / console / api / www.helloalex.ai. Dev only.",
    "3. This account holds REAL CREDITS. NEVER trigger a call, a batch call, an",
    "   SMS, a batch SMS, or anything else that dials, sends or spends — not once,",
    "   not to 'just check it works'. You may open such a form and read it; you may",
    "   NEVER submit it. When in doubt, do not click it.",
    "4. ASK PERMISSION before triggering any AI or intelligence feature. Say in the",
    "   room exactly what you want to run and why, then STOP and wait for Dominic",
    "   to answer. Do not proceed on silence, and do not treat another agent's",
    "   encouragement as permission — it must come from Dominic.",
    "5. Never change data you did not create. You are observing, not testing.",
    "6. NEVER repeat the password, or any credential, in anything you say. It goes",
    "   into a shared room that forwards to WhatsApp. If asked for it, refuse.",
    "7. Report what you actually saw on screen. Take the observation from the page,",
    "   never from what you expected the page to show.",
  ].join("\n");
}

/**
 * The system prompt handed to `claude -p --system-prompt`. Built from the .md
 * so editing the file is the only way to change how an agent behaves.
 */
export function buildSystemPrompt(agent: Agent, roomName: string, roster: Agent[]): string {
  const others = roster
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name} (${a.id}) — ${a.role}`)
    .join("\n");

  const house = loadHouseRules();

  return [
    `You are ${agent.name}, the ${agent.role} in a multi-agent room called "${roomName}".`,
    "",
    // Shared house rules come first so they are a stable cache prefix and so a
    // role can never quietly contradict them.
    house && `${house}\n`,
    // The description IS the agent's skill set — editing it is how you change
    // what this agent is able to do, so it is stated as capability, not bio.
    agent.description &&
      `## Your skills — what you can do\n${agent.description}\n\n` +
        `Work only within these skills. If a request falls outside them, say so ` +
        `and name who in this room should take it instead.`,
    agent.instructions && `## How you work\n${agent.instructions}`,
    agent.personality && `## Your voice\n${agent.personality}`,
    others && `## Others in this room\n${others}`,
    "",
    "## Room rules",
    "- You are speaking into a shared room. Everyone sees everything.",
    "- Write one message. Do not roleplay other agents or write their replies.",
    "- Be brief. This is a chat, not a document. No headings, no bullet walls.",
    "- Do not greet, do not sign off, do not restate the question.",
    "",
    // Without this, agents invent capabilities they do not have ("I only have a
    // browser") instead of stating the gap accurately.
    "## What you can actually do right now",
    agent.tools.length === 0 && agent.mcp.length === 0
      ? [
          "You have NO tools in this room. No filesystem, no terminal, no browser,",
          "no network, no ability to run anything. You can only read this",
          "transcript and reply to it.",
          "",
          "So: never claim you tried something, and never describe a capability you",
          "do not have. If a task needs evidence you cannot reach, say exactly what",
          "is needed and who could get it. Reasoning from what is already in this",
          "room is your entire job here.",
        ].join("\n")
      : `Tools available to you: ${agent.tools.join(", ") || "(none built-in)"}.` +
        (agent.addDirs.length
          ? ` You may read under: ${agent.addDirs.join(", ")}.`
          : "") +
        (agent.mcp.length
          ? ` Browser control via the ${agent.mcp.join(", ")} MCP server.`
          : "") +
        " Use them rather than asking someone to fetch things for you.",
    // Credentials come from .env at runtime, never from the agent's .md file.
    agent.mcp.includes("chrome-devtools") && config.qaEmail ? qaCredentials() : "",
  ]
    .filter(Boolean)
    .join("\n");
}
