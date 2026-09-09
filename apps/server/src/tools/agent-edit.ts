/**
 * The guarded editor behind scripts/agent-edit.sh.
 *
 * Runs as a separate process, never inside the server: the wrapper is the
 * permission boundary and this is the tool it hands off to. It shares the
 * server's own parser (`sections`, `parseAgentFile`) so what it splices is
 * exactly what the loader reads — the editor and the loader cannot drift apart
 * the way a second awk implementation would.
 *
 * What it guarantees before a single byte is written, in order:
 *   1. the path is a real file directly inside agents/, not a symlink, not a
 *      template, not the dead house-rules file;
 *   2. only `instructions` or `personality` changes (or a rules file body);
 *   3. the frontmatter bytes, the set of `## ` headings, and the parsed name,
 *      role and description are identical before and after;
 *   4. the new body is bounded, cannot open a new section or frontmatter, and
 *      carries nothing that looks like a credential;
 *   5. the write is temp-file + rename, and it is one git commit authored as
 *      the agent, with a trailer `undo` can find.
 *
 * Exit codes follow the house convention: 64 usage, 77 refused, 70 internal.
 */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.ts";
import { parseAgentFile, sections } from "../agents/registry.ts";

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const MAX_BODY = 6_000;
const MAX_RULES = 12_000;
const MAX_DIFF = 4_000;
const CREDENTIAL = /password|AGORA_QA_|\b\d{10,}@g\.us\b|\bsk-[A-Za-z0-9]{10,}\b|BEGIN [A-Z ]*PRIVATE KEY/i;

function usage(): never {
  console.error("agent-edit: show|preview|set <id> <section> · show-rules|set-rules <slug> · undo|log <id> [--as <id>]");
  process.exit(64);
}
function refuse(msg: string): never {
  console.error("agent-edit: refused — " + msg);
  process.exit(77);
}
function internal(msg: string): never {
  console.error("agent-edit: " + msg);
  process.exit(70);
}

// ---- argv ---------------------------------------------------------------
const argv = process.argv.slice(2);
let author = "mechanic";
const asAt = argv.indexOf("--as");
if (asAt !== -1) {
  author = argv[asAt + 1] ?? "";
  if (!SLUG.test(author)) refuse(`bad --as "${author}"`);
  argv.splice(asAt, 2);
}
const [cmd, a1, a2] = argv;
if (!cmd) usage();

// ---- path resolution ----------------------------------------------------
const agentsDir = realpathSync(config.agentsDir);

function insideAgents(path: string): boolean {
  const real = realpathSync(path);
  return real.startsWith(agentsDir + sep) && !relative(agentsDir, real).includes(sep);
}

function agentPath(id: string): string {
  if (!SLUG.test(id)) refuse(`bad agent id "${id}"`);
  const path = join(config.agentsDir, `${id}.md`);
  if (!existsSync(path)) refuse(`no agent called "${id}"`);
  if (lstatSync(path).isSymbolicLink()) refuse(`"${id}" is a symlink`);
  if (!insideAgents(path)) refuse(`"${id}" resolves outside agents/`);
  return path;
}

function rulesPath(slug: string): string {
  if (!SLUG.test(slug)) refuse(`bad room slug "${slug}"`);
  const path = join(config.agentsDir, `_rules-${slug}.md`);
  if (!existsSync(path)) refuse(`no rules file for room "${slug}" — a room writes its own on creation`);
  if (lstatSync(path).isSymbolicLink()) refuse(`rules file for "${slug}" is a symlink`);
  if (!insideAgents(path)) refuse("rules file resolves outside agents/");
  return path;
}

// ---- splicing -----------------------------------------------------------
function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function checkBody(body: string, max: number, what: string): string {
  const b = body.replace(/\r\n/g, "\n").trim();
  if (!b) refuse(`empty ${what} on stdin`);
  if (b.length > max) refuse(`${what} is ${b.length} chars; the cap is ${max}`);
  if (/^---\s*$/m.test(b)) refuse(`${what} contains a "---" line, which would open frontmatter`);
  if (/^##\s/m.test(b)) refuse(`${what} contains a "## " line, which would create a section`);
  if (/^#\s/m.test(b)) refuse(`${what} contains a "# " title line`);
  if (CREDENTIAL.test(b)) refuse(`${what} contains something that looks like a credential`);
  return b;
}

/** Replace the body of one `## Heading` section, leaving every other byte alone. */
function spliceSection(raw: string, heading: string, body: string): string {
  const fm = raw.match(FRONTMATTER);
  const head = fm ? fm[0] : "";
  const rest = raw.slice(head.length);
  const re = new RegExp("^##\\s+" + heading + "\\s*$", "im");
  const m = rest.match(re);
  if (!m || m.index === undefined) refuse(`no "## ${heading}" section in this file`);
  const start = m.index + m[0].length;
  const next = rest.slice(start).search(/^##\s+/m);
  const end = next === -1 ? rest.length : start + next;
  return head + rest.slice(0, start) + "\n" + body + "\n\n" + rest.slice(end).replace(/^\n+/, "");
}

function headings(raw: string): string {
  return (raw.match(/^##\s+.*$/gm) ?? []).map((h) => h.trim().toLowerCase()).join("|");
}

function parseRaw(raw: string): { name: string; role: string; description: string } {
  const fm = raw.match(FRONTMATTER);
  const s = sections(raw.slice(fm ? fm[0].length : 0));
  return {
    name: s.get("name") ?? "",
    role: s.get("role") ?? "",
    description: s.get("description") ?? "",
  };
}

/** The invariants that make this a prompt editor and not a permission editor. */
function assertUnchanged(before: string, after: string): void {
  const fb = before.match(FRONTMATTER)?.[0] ?? "";
  const fa = after.match(FRONTMATTER)?.[0] ?? "";
  if (fb !== fa) refuse("frontmatter would change — nothing written");
  if (headings(before) !== headings(after)) refuse("the set of sections would change — nothing written");
  const pb = parseRaw(before);
  const pa = parseRaw(after);
  if (pb.name !== pa.name || pb.role !== pa.role || pb.description !== pa.description) {
    refuse("name, role or description would change — nothing written");
  }
}

// ---- git ----------------------------------------------------------------
function git(args: string[], opts: { ok?: number[] } = {}): string {
  try {
    return execFileSync("git", ["-C", config.root, ...args], { encoding: "utf8", timeout: 15_000 });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    if (e.status !== undefined && (opts.ok ?? []).includes(e.status)) return e.stdout ?? "";
    internal(`git ${args[0]} failed: ${(e.stderr ?? "").trim().slice(0, 300)}`);
  }
}

function commit(rel: string, subject: string, trailer: string): string {
  git(["add", "--", rel]);
  git([
    "-c", `user.name=${author}`,
    "-c", `user.email=${author}@agents.agora`,
    "commit", "-q", "-o", rel, "-m", subject + "\n\n" + trailer,
  ]);
  return git(["rev-parse", "--short", "HEAD"]).trim();
}

/** A dirty file gets its own commit first, so the agent's change is one revertable unit. */
function snapshotIfDirty(rel: string, id: string): void {
  if (git(["status", "--porcelain", "--", rel]).trim()) {
    commit(rel, `snapshot(${id}): manual edits before ${author}`, `Agora-Snapshot: ${author} ${id}`);
  }
}

function diffAgainst(path: string, next: string): string {
  const tmp = join(tmpdir(), `agent-edit-${process.pid}-${basename(path)}`);
  writeFileSync(tmp, next, "utf8");
  try {
    const out = git(["diff", "--no-index", "--", path, tmp], { ok: [1] });
    const lines = out.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l));
    const text = lines.join("\n").trim();
    return text.length > MAX_DIFF ? text.slice(0, MAX_DIFF) + `\n[diff truncated at ${MAX_DIFF} chars]` : text;
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

// ---- the "before" line -------------------------------------------------
function beforeLine(id: string): string {
  try {
    const db = new DatabaseSync(config.dbPath, { readOnly: true });
    const since = Date.now() - 14 * 86_400_000;
    const row = db
      .prepare(
        "SELECT COUNT(*) AS n, AVG(LENGTH(text)) AS avg, " +
          "SUM(CASE WHEN act IS NOT NULL AND next_id IS NOT NULL THEN 1 ELSE 0 END) AS marked " +
          "FROM messages WHERE kind='agent' AND author_id=? AND created_at>=? AND text NOT LIKE 'Progress check%'",
      )
      .get(id, since) as { n: number; avg: number | null; marked: number };
    if (!row.n) return `before: no messages from ${id} in the last 14 days`;
    return `before: ${row.n} msgs · avg ${Math.round(row.avg ?? 0)} chars · markers ${Math.round((100 * row.marked) / row.n)}%`;
  } catch {
    return "before: (metrics unavailable)";
  }
}

// ---- commands -----------------------------------------------------------
switch (cmd) {
  case "show": {
    if (!a1 || !a2) usage();
    const agent = parseAgentFile(agentPath(a1));
    process.stdout.write((a2 === "instructions" ? agent.instructions : agent.personality) + "\n");
    break;
  }
  case "show-rules": {
    if (!a1) usage();
    process.stdout.write(readFileSync(rulesPath(a1), "utf8").slice(0, 40_000) + "\n");
    break;
  }
  case "log": {
    if (!a1) usage();
    const rel = relative(config.root, agentPath(a1));
    process.stdout.write(git(["log", "--date=short", "--format=%h %ad %an  %s", "-n", "10", "--", rel]) || "(no history)\n");
    break;
  }
  case "preview":
  case "set": {
    if (!a1 || !a2) usage();
    const path = agentPath(a1);
    const heading = a2 === "instructions" ? "Instructions" : "Personality";
    const body = checkBody(readStdin(), MAX_BODY, `${a2} body`);
    const before = readFileSync(path, "utf8");
    const after = spliceSection(before, heading, body);
    assertUnchanged(before, after);
    if (after === before) refuse("no change");
    const diff = diffAgainst(path, after);
    const oldLen = (sections(before).get(a2) ?? "").length;
    if (cmd === "preview") {
      process.stdout.write(`${diff}\n\npreview only — nothing written. ${a2}: ${oldLen} -> ${body.length} chars\n${beforeLine(a1)}\n`);
      break;
    }
    const rel = relative(config.root, path);
    snapshotIfDirty(rel, a1);
    writeAtomic(path, after);
    // Parse it back through the real loader: if this throws, restore on the spot.
    try {
      parseAgentFile(path);
    } catch (err) {
      writeAtomic(path, before);
      internal(`written file failed to parse and was restored: ${err instanceof Error ? err.message : String(err)}`);
    }
    const hash = commit(
      rel,
      `edit(${a1}): ${a2} ${oldLen}->${body.length} chars by ${author}`,
      `Agora-Edit: ${author} ${a1} ${a2} ${oldLen}->${body.length}`,
    );
    process.stdout.write(
      `${diff}\n\nwritten and committed as ${hash}. ${a2}: ${oldLen} -> ${body.length} chars. Reload is automatic.\n` +
        `${beforeLine(a1)}\nRun agora-eval.sh --agent ${a1} now, and undo if it got worse.\n`,
    );
    break;
  }
  case "set-rules": {
    if (!a1) usage();
    const path = rulesPath(a1);
    const raw = readStdin().replace(/\r\n/g, "\n").trim();
    if (!raw) refuse("empty rules body on stdin");
    if (raw.length > MAX_RULES) refuse(`rules body is ${raw.length} chars; the cap is ${MAX_RULES}`);
    if (!/^#\s/.test(raw)) refuse("a rules file starts with a '# ' title line");
    if (CREDENTIAL.test(raw)) refuse("rules body contains something that looks like a credential");
    const before = readFileSync(path, "utf8");
    const after = raw + "\n";
    if (after === before) refuse("no change");
    const diff = diffAgainst(path, after);
    const rel = relative(config.root, path);
    snapshotIfDirty(rel, a1);
    writeAtomic(path, after);
    const hash = commit(
      rel,
      `rules(${a1}): ${before.length}->${after.length} chars by ${author}`,
      `Agora-Edit: ${author} _rules-${a1} rules ${before.length}->${after.length}`,
    );
    process.stdout.write(`${diff}\n\nwritten and committed as ${hash}. Rules are re-read on every turn.\n`);
    break;
  }
  case "undo": {
    if (!a1) usage();
    const rel = relative(config.root, agentPath(a1));
    const last = git(["log", "--format=%H %s", "--grep", `^Agora-Edit: [a-z0-9-]* ${a1} `, "-n", "1", "--", rel]).trim();
    if (!last) refuse(`no agent edit of "${a1}" to undo — snapshots and manual commits are not reverted here`);
    const [hash, ...subject] = last.split(" ");
    try {
      execFileSync(
        "git",
        ["-C", config.root, "-c", `user.name=${author}`, "-c", `user.email=${author}@agents.agora`, "revert", "--no-edit", hash!],
        { encoding: "utf8", timeout: 15_000 },
      );
    } catch (err) {
      git(["revert", "--abort"], { ok: [1, 128] });
      internal(`revert of ${hash!.slice(0, 7)} did not apply cleanly and was abandoned: ${(err as { stderr?: string }).stderr?.trim().slice(0, 200) ?? ""}`);
    }
    process.stdout.write(`reverted ${hash!.slice(0, 7)} (${subject.join(" ")}) as ${git(["rev-parse", "--short", "HEAD"]).trim()}. Reload is automatic.\n`);
    break;
  }
  default:
    usage();
}
