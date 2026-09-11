import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import chokidar from "chokidar";
import { toCursorModelId } from "../agent-models.ts";
import { config } from "../config.ts";
import { phoneStyleText, protocolText } from "../protocol.ts";
import type { Agent, Tailor } from "../types.ts";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Pull `## Heading` sections out of the markdown body. */
export function sections(body: string): Map<string, string> {
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
    // Cursor bakes effort into the model id. Under cursor/hybrid we resolve the
    // frontmatter pair to a Cursor-valid id here so the UI and the driver agree
    // (bare `claude-sonnet-5` is rejected by cursor-agent). Files may still
    // store Claude-style model+effort; baking is in-memory until the next save.
    model: (() => {
      const fileModel =
        typeof meta["model"] === "string" && meta["model"].trim()
          ? meta["model"].trim()
          : "";
      const fileEffort =
        typeof meta["effort"] === "string" && meta["effort"].trim()
          ? meta["effort"].trim()
          : config.effort;
      if (config.driver === "cursor" || config.driver === "hybrid") {
        const fallback = config.cursorModel.trim() || "auto";
        // auto = subscription seat only. Do not bake Claude frontmatter into
        // API model ids that burn Pro+ usage limits.
        if (fallback === "auto") return "auto";
        return toCursorModelId(fileModel, fileEffort, fallback);
      }
      return fileModel || config.model;
    })(),
    effort:
      config.driver === "cursor" || config.driver === "hybrid"
        ? "n/a"
        : typeof meta["effort"] === "string"
          ? meta["effort"]
          : config.effort,
    tools: asStringArray(meta["tools"]),
    addDirs: asStringArray(meta["add_dirs"]),
    mcp: asStringArray(meta["mcp"]),
    allow: asStringArray(meta["allow"]),
    // Resolved against the project root so an agent file stays portable.
    mcpConfigs: asStringArray(meta["mcp_configs"]).map((p) =>
      p.startsWith("/") ? p : join(config.root, p),
    ),
    orchestrator: meta["orchestrator"] === true,
    file: path,
    forgedBy: typeof meta["forged_by"] === "string" ? meta["forged_by"] : null,
  };
}

/** Slug rule for anything an agent names: an id, a template, a room rules file. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

export function listTemplates(): string[] {
  try {
    return readdirSync(config.templatesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Forge a new agent from a template.
 *
 * The template's frontmatter is copied BYTE FOR BYTE — tools, allow, add_dirs,
 * mcp and the comments explaining them — plus two lines recording who forged
 * it and when. The orchestrator supplies only identity and a brief. That is the
 * whole safety argument: an agent can create a colleague, and can never grant
 * one a capability, because the only capabilities that exist are the ones
 * Dominic wrote into a template.
 */
/** The first sentence or two of a brief, capped, as a lane statement. */
function laneFromBrief(brief: string): string {
  const flat = brief.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = flat.split(/(?<=[.!?])\s+/);
  let out = parts[0] ?? "";
  if (parts[1] && (out + " " + parts[1]).length <= 240) out += " " + parts[1];
  return out.slice(0, 260);
}

export function forgeAgent(input: {
  template: string;
  id: string;
  name: string;
  role: string;
  brief: string;
  forgedBy: string;
}): Agent {
  const template = input.template.trim().toLowerCase();
  const id = input.id.trim().toLowerCase();
  if (!SLUG.test(template)) throw new Error(`Bad template name "${input.template}"`);
  if (!SLUG.test(id)) throw new Error(`Bad agent id "${input.id}" — lowercase letters, digits and dashes`);
  const templatePath = join(config.templatesDir, `${template}.md`);
  if (!existsSync(templatePath)) throw new Error(`No template called "${template}"`);
  const path = join(config.agentsDir, `${id}.md`);
  if (existsSync(path)) throw new Error(`An agent called "${id}" already exists`);

  const raw = readFileSync(templatePath, "utf8");
  const fm = raw.match(FRONTMATTER);
  if (!fm) throw new Error(`Template "${template}" has no frontmatter`);
  const base = parseAgentFile(templatePath);
  const name = input.name.trim().slice(0, 60) || base.name;
  const role = input.role.trim().slice(0, 60) || base.role;
  const brief = input.brief.trim().slice(0, 2000);
  // The first sentence of the brief is the agent's lane and becomes its own
  // description of its skills. Capabilities are NOT written here: the prompt
  // builder derives them from the frontmatter on every turn (describeCapabilities).
  const lane = laneFromBrief(brief) || base.description.trim();

  const frontmatter =
    fm[1] +
    `\n# Forged from templates/agents/${template}.md. Capabilities above are the template's.\n` +
    `forged_by: ${input.forgedBy}\n` +
    `forged_at: ${new Date().toISOString()}\n`;

  const body = [
    `# Agent: ${name}`,
    "",
    "## Name",
    name,
    "",
    "## Role",
    role,
    "",
    "## Description",
    lane,
    "",
    "## Instructions",
    base.instructions.trim(),
    "",
    "### Your brief",
    brief,
    "",
    "## Personality",
    base.personality.trim(),
    "",
  ].join("\n");

  writeFileSync(path, `---\n${frontmatter}---\n\n${body}`, "utf8");
  return parseAgentFile(path);
}

/**
 * Apply a capability grant Dominic gave IN THE ROOM to one agent's file.
 *
 * This is the only code path anywhere that changes `tools`, `add_dirs` or
 * `allow`, and it runs only from `Orchestrator.applyAccess`, which requires the
 * grant to come from Dominic's own typed message ("i-access mo ang X",
 * "tignan mo ang KooyaPedia"). The safety line — agents never grant capability
 * — holds: the orchestrator names who, Dominic said what.
 *
 * The frontmatter is edited in place: the three keys are removed in whichever
 * form they were written (flow or block) and re-emitted as flow lists at the
 * end; every other line, including the comments explaining earlier grants,
 * survives. Values are merged, never replaced, so a grant only ever adds.
 */
export function grantAccess(
  agentId: string,
  grant: { dirs?: string[]; allow?: string[]; tools?: string[] },
): Agent {
  return rewriteAccess(agentId, (c) => ({
    tools: [...new Set([...c.tools, ...(grant.tools ?? [])])],
    dirs: [...new Set([...c.addDirs, ...(grant.dirs ?? [])])],
    allow: [...new Set([...c.allow, ...(grant.allow ?? [])])],
  }));
}

/**
 * Take back a per-goal grant when the goal closes. Tools stay: a bare Read or
 * Bash with no dir and no allow line reaches nothing.
 */
export function revokeAccess(agentId: string, rev: { dirs?: string[]; allow?: string[] }): Agent {
  return rewriteAccess(agentId, (c) => ({
    tools: c.tools,
    dirs: c.addDirs.filter((d) => !(rev.dirs ?? []).includes(d)),
    allow: c.allow.filter((a) => !(rev.allow ?? []).includes(a)),
  }));
}

function rewriteAccess(
  agentId: string,
  compute: (current: Agent) => { tools: string[]; dirs: string[]; allow: string[] },
): Agent {
  const path = join(config.agentsDir, `${agentId}.md`);
  if (!existsSync(path)) throw new Error(`No agent called "${agentId}"`);
  const raw = readFileSync(path, "utf8");
  const fm = raw.match(FRONTMATTER);
  if (!fm) throw new Error(`${agentId} has no frontmatter`);
  const { tools, dirs, allow } = compute(parseAgentFile(path));

  const lines = fm[1]!.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const key = ln.match(/^(tools|add_dirs|allow):\s*(.*)$/);
    if (!key) {
      kept.push(ln);
      continue;
    }
    if ((key[2] ?? "").startsWith("[")) {
      // Flow form, possibly spanning lines until the closing bracket.
      let acc = key[2] ?? "";
      while (!acc.includes("]") && i + 1 < lines.length) acc += lines[++i]!;
    } else {
      // Block form: swallow the "  - item" lines that follow.
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1]!)) i++;
    }
  }
  const flow = (xs: string[]): string => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
  while (kept.length && kept[kept.length - 1]!.trim() === "") kept.pop();
  kept.push(`tools: ${flow(tools)}`);
  if (dirs.length) kept.push(`add_dirs: ${flow(dirs)}`);
  if (allow.length) kept.push(`allow: ${flow(allow)}`);

  const body = raw.slice(fm[0].length);
  writeFileSync(path, `---\n${kept.join("\n")}\n---\n${body.startsWith("\n") ? body : "\n" + body}`, "utf8");
  return parseAgentFile(path);
}

/**
 * The rules file a new room reads. Written once at creation so the room has a
 * place for project facts from the first turn; Dominic or the mechanic fills it.
 */
export function writeRoomRules(roomName: string, topic: string): string | null {
  const slug = slugify(roomName);
  if (!slug) return null;
  const path = join(config.agentsDir, `_rules-${slug}.md`);
  if (existsSync(path)) return path;
  writeFileSync(
    path,
    [`# ${roomName}`, "", topic.trim() ? `Purpose: ${topic.trim()}` : "Purpose: (fill in)", ""].join("\n"),
    "utf8",
  );
  return path;
}

/**
 * Per-room rules, layered on top of the house rules.
 *
 * The house file carries how to behave in a room; this one carries what the
 * room is ABOUT - paths, protocol, the traps specific to that project. Without
 * the split, every agent in every room is told helloalex2 is "the main repo",
 * which is wrong the moment a second room exists.
 *
 * Keyed off the slugified room name, so `Voicemail Detection` reads
 * `_rules-voicemail-detection.md`. That keeps the file hand-editable and
 * greppable rather than naming it after a UUID, and needs no schema change.
 * The cost: RENAMING A ROOM SILENTLY ORPHANS ITS RULES FILE. Rename the file
 * to match, or the room quietly loses its project context.
 *
 * Absent file = empty string, the normal case for a room that needs nothing
 * beyond the house rules.
 */
export function loadRoomRules(roomName: string): string {
  const slug = slugify(roomName);
  if (!slug) return "";
  try {
    return readFileSync(join(config.agentsDir, `_rules-${slug}.md`), "utf8").trim();
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
  mcp?: string[];
  allow?: string[];
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
  // Round-trip capability grants. Omitting these meant saving an agent from the
  // UI silently revoked its browser access and web permissions — the edit looked
  // like a model change and was quietly a downgrade.
  if (a.mcp?.length) {
    lines.push(`mcp: [${a.mcp.map((m) => JSON.stringify(m)).join(", ")}]`);
  }
  if (a.allow?.length) {
    lines.push(`allow: [${a.allow.map((p) => JSON.stringify(p)).join(", ")}]`);
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
 * What an agent can and cannot do, in plain sentences, derived from the grants
 * it holds RIGHT NOW. Built on every turn, so it never drifts when a per-goal
 * grant is given or returned. This is the text that used to be hand-written
 * into `## Description`; the description is now only the agent's lane.
 */
const WRAPPER_PHRASES: Record<string, string> = {
  "kooyapedia-lookup.sh": "read KooyaPedia, the team wiki (kooyapedia-lookup.sh search, show, recent, projects)",
  "kooyapedia-edit.sh": "edit KooyaPedia articles through kooyapedia-edit.sh (get, set, new)",
  "kooyapedia-start.sh": "bring KooyaPedia up if it is down (kooyapedia-start.sh)",
  "ecc-lookup.sh": "look up the ECC skills library (ecc-lookup.sh search, list, show)",
  "agent-edit.sh":
    "edit the Instructions or Personality of an agent file, or a room's rules, through agent-edit.sh (show, preview, set, undo); frontmatter, names and roles are refused",
  "agora-eval.sh": "measure an agent with the eval (agora-eval.sh --agent <id>)",
  "git-read.sh": "read git history and diffs (git-read.sh)",
  "claude-run.sh": "execute inside the Voicemail Detection project through claude-run.sh (read and inspect; it cannot launch training)",
  "claude-edit.sh": "change files in the Voicemail Detection project through claude-edit.sh",
  "train-launch.sh": "start a training run and return immediately (train-launch.sh)",
  "erasr-run.sh": "run and inspect erasr through erasr-run.sh",
  "erasr-edit.sh": "change erasr files through erasr-edit.sh",
  "erasr-bench.sh": "benchmark erasr through erasr-bench.sh",
  "erasr-job.sh": "run a long erasr job through erasr-job.sh",
  "start-chrome.sh": "start the QA browser (start-chrome.sh)",
};
const EDIT_WRAPPERS = new Set(["kooyapedia-edit.sh", "agent-edit.sh", "claude-edit.sh", "erasr-edit.sh"]);
const RUN_WRAPPERS = new Set(["claude-run.sh", "train-launch.sh", "erasr-run.sh", "erasr-bench.sh", "erasr-job.sh", "kooyapedia-start.sh"]);

export function describeCapabilities(agent: Agent): string {
  const allow = effectiveAllow(agent);
  const wrappers = allow
    .map((g) => /scripts\/([a-z0-9-]+\.sh)/.exec(g)?.[1])
    .filter((x): x is string => Boolean(x));
  const web = allow.some((g) => /^WebSearch/.test(g)) || agent.tools.includes("WebSearch");
  const fetch = allow.some((g) => /^WebFetch/.test(g)) || agent.tools.includes("WebFetch");
  const canRead = ["Read", "Glob", "Grep"].some((t) => agent.tools.includes(t));
  const canWrite = ["Write", "Edit"].some((t) => agent.tools.includes(t));
  const dirs = agent.addDirs;

  const can: string[] = [];
  if (canRead) {
    can.push(dirs.length ? `read files under ${dirs.join(", ")}` : "read files in the Agora repo itself (its agents, scripts and code)");
  }
  if (canWrite) {
    can.push(dirs.length ? `create and edit files under ${dirs.join(", ")}` : "create and edit files in the Agora repo itself");
  }
  if (web) can.push("search the web (WebSearch)");
  if (fetch) can.push("read web pages (WebFetch)");
  for (const w of [...new Set(wrappers)]) can.push(WRAPPER_PHRASES[w] ?? `run ${w}`);
  for (const id of agent.mcp) {
    can.push(id === "chrome-devtools" ? "drive the QA browser through the chrome-devtools MCP server" : `use the ${id} MCP server`);
  }
  if (agent.tools.includes("Bash") && wrappers.length === 0) {
    can.push("run shell commands only through wrappers you are granted (none right now)");
  }

  const cannot: string[] = [];
  if (!canWrite && !wrappers.some((w) => EDIT_WRAPPERS.has(w))) cannot.push("create or edit files");
  if (!wrappers.includes("kooyapedia-lookup.sh") && !wrappers.includes("kooyapedia-edit.sh")) {
    cannot.push("read the wiki unless a goal grants kooyapedia-lookup.sh");
  }
  if (!web && !fetch) cannot.push("reach the web");
  if (!wrappers.some((w) => RUN_WRAPPERS.has(w))) cannot.push("execute or start anything");
  if (!canRead && !dirs.length) cannot.push("see project folders on disk");

  return [
    can.length ? "You can:" : "You can: nothing beyond reading this transcript and replying to it.",
    ...can.map((c) => `- ${c}`),
    cannot.length ? `You cannot ${cannot.join("; ")}.` : "",
    agent.tools.includes("Bash")
      ? "Bash runs only the wrappers listed above; anything else is refused."
      : "",
    "Use what you hold rather than asking someone to fetch it, and never claim to",
    "have checked something you cannot reach. Spawning a colleague never adds a",
    "capability: a forged agent has exactly its template's grants. Say what you",
    "cannot do in one line and name who in the room can.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The system prompt handed to `claude -p --system-prompt`. Built from the .md
 * so editing the file is the only way to change how an agent behaves.
 */
export function buildSystemPrompt(
  agent: Agent,
  roomName: string,
  roster: Agent[],
  opts: { chatTurn?: boolean; tailor?: Tailor | null; goalTitle?: string | null } = {},
): string {
  const t = opts.tailor;
  const tailored = t && (t.skills || t.instructions || t.personality);
  const others = roster
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name} (${a.id}) — ${a.role}`)
    .join("\n");

  const roomRules = loadRoomRules(roomName);

  return [
    `You are ${agent.name}, the ${agent.role} in a multi-agent room called "${roomName}".`,
    "",
    // L0 comes first: byte-identical for every agent in every room, so it is a
    // stable cache prefix, and nothing below it can quietly contradict it.
    // Emitted from protocol.ts rather than read from a file — see the note there
    // on why this is a contract and not a convention.
    `${protocolText()}\n`,
    // The phone style guide goes to the one role that writes phone messages.
    // Every specialist used to pay for it on every turn.
    agent.orchestrator && `${phoneStyleText()}\n`,
    // L2 — room rules sit AFTER the protocol so the shared text stays a stable
    // cache prefix across every room.
    roomRules && `${roomRules}\n`,
    // The description IS the agent's skill set — editing it is how you change
    // what this agent is able to do, so it is stated as capability, not bio.
    agent.description &&
      `## Your skills — what you can do\n${agent.description}\n\n` +
        `Work only within these skills. If a request falls outside them, say so ` +
        `and name who in this room should take it instead.`,
    agent.instructions && `## How you work\n${agent.instructions}`,
    agent.personality && `## Your voice\n${agent.personality}`,
    // L3.5 — how the orchestrator tailored this agent for the goal in hand.
    // Sits after the standing sections and says it wins where they differ, so
    // the objective shapes the agent without anyone editing its file.
    tailored
      ? [
          `## For this goal${opts.goalTitle ? ` — ${opts.goalTitle}` : ""}`,
          `The orchestrator tailored your role for this objective. It adds to your ` +
            `standing sections above and wins where they differ, for this goal only.`,
          t.skills ? `### Skills for this goal\n${t.skills.trim()}` : "",
          t.instructions ? `### How to work on this goal\n${t.instructions.trim()}` : "",
          t.personality ? `### Voice for this goal\n${t.personality.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : "",
    others && `## Others in this room\n${others}`,
    "",
    // Without this, agents invent capabilities they do not have ("I only have a
    // browser") instead of stating the gap accurately.
    // A chat turn switches tools off for ONE reply. Saying "you have no tools"
    // here was a real bug: the agent concluded the ROOM had no tools and told
    // Dominic the room could not write code or train — while Berlin, Tokyo and
    // Rio were holding exactly those grants. Off for this turn is not the same
    // as absent, and the prompt now says so.
    opts.chatTurn
      ? [
          "## This turn is a conversation, not a task",
          "Dominic asked you directly, so answer from what you already know, in your",
          "own words. Do not mention tools and do not announce that you could not",
          "look anything up. If a proper answer needs a file, a page or the wiki,",
          "say in one line what you would check and that he only has to say",
          "'check it'. The room's capabilities are exactly as described above; never",
          "tell him the room cannot do something it can, and never claim you looked",
          "something up this turn, because you did not.",
        ].join("\n")
      : "## What you can actually do right now",
    !opts.chatTurn && agent.tools.length === 0 && agent.mcp.length === 0
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
      : opts.chatTurn
      ? ""
      : describeCapabilities(agent),
    // Credentials come from .env at runtime, never from the agent's .md file.
    agent.mcp.includes("chrome-devtools") && config.qaEmail ? qaCredentials() : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Wrappers every agent that holds Bash may run, in every room, without a
 * grant. Deliberately NOT written into any agent file: a house grant living in
 * frontmatter is one more copy to drift, the editor would round-trip it, and
 * revoking a per-goal grant would take it with it. Applied once, at the point
 * the allow list reaches the driver. L0 in protocol.ts tells agents it exists.
 */
export const HOUSE_ALLOW: readonly string[] = [
  "Bash(bash /home/dominickooya/agora/scripts/kooyapedia-start.sh:*)",
];

/** The allow list the driver actually gets: the agent's own, plus the house wrappers if it holds Bash. */
export function effectiveAllow(agent: Agent): string[] {
  if (!agent.tools.includes("Bash")) return agent.allow;
  return [...new Set([...agent.allow, ...HOUSE_ALLOW])];
}
