// The HTTP half of scripts/kooyapedia-edit.sh. Talks to the wiki exactly as
// the browser's Edit page does: GET the form for the current source, POST the
// same fields to save. Every save is a wiki revision, so it can be restored.
import { readFileSync } from "node:fs";

const BASE = (process.env.KOOYAPEDIA_URL ?? "http://172.31.224.1:4711").replace(/\/$/, "");
const MAX_BODY = 200_000;
const [cmd, ...rest] = process.argv.slice(2);

const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(parseInt(e[1] === "x" ? e.slice(2) : e.slice(1), e[1] === "x" ? 16 : 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[e.toLowerCase()] ?? m;
  });

function unreachable(err) {
  console.error(`kooyapedia-edit: cannot reach ${BASE} (${err.message}). It is down. Bring it up yourself: bash /home/dominickooya/agora/scripts/kooyapedia-start.sh, then retry.`);
  process.exit(70);
}

function opt(name) {
  const i = rest.indexOf(name);
  return i === -1 ? null : (rest[i + 1] ?? null);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

if (cmd === "get") {
  const slug = rest[0];
  let res;
  try {
    res = await fetch(`${BASE}/edit/${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    unreachable(err);
  }
  if (res.status === 404) {
    console.error(`kooyapedia-edit: no article "${slug}"`);
    process.exit(77);
  }
  const html = await res.text();
  const m = html.match(/<textarea[^>]*\bname="body"[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!m) {
    console.error("kooyapedia-edit: the edit page had no body field — is this article read-only?");
    process.exit(77);
  }
  const title = html.match(/<input[^>]*\bname="title"[^>]*\bvalue="([^"]*)"/i)?.[1];
  const space = html.match(/<select[^>]*\bname="space"[^>]*>[\s\S]*?<option[^>]*\bselected[^>]*>([^<]*)</i)?.[1];
  console.log(`# title: ${decode(title ?? "")}`);
  if (space) console.log(`# space: ${decode(space)}`);
  console.log(decode(m[1]));
} else if (cmd === "set" || cmd === "new") {
  const slug = cmd === "set" ? rest[0] : "-";
  const title = (opt("--title") ?? "").trim();
  const space = (opt("--space") ?? "").trim();
  const comment = (opt("--comment") ?? "via Agora").trim();
  if (!title) {
    console.error("kooyapedia-edit: --title is required");
    process.exit(64);
  }
  if (title.length > 200) {
    console.error("kooyapedia-edit: title is over 200 characters");
    process.exit(77);
  }
  const body = readStdin().replace(/\r\n/g, "\n");
  if (!body.trim()) {
    console.error("kooyapedia-edit: empty body on stdin");
    process.exit(77);
  }
  if (body.length > MAX_BODY) {
    console.error(`kooyapedia-edit: body is ${body.length} chars; the cap is ${MAX_BODY}`);
    process.exit(77);
  }
  const form = new URLSearchParams({ title, body, author: "agora", comment });
  if (space) form.set("space", space);
  let res;
  try {
    res = await fetch(`${BASE}/edit/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    unreachable(err);
  }
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get("location") ?? "";
    const saved = decodeURIComponent(to.replace(/^\/wiki\//, ""));
    console.log(`saved ${saved} — ${BASE}/wiki/${encodeURIComponent(saved)} (revision recorded by the wiki; restore from its History tab)`);
    process.exit(0);
  }
  const text = await res.text();
  const err = decode(text.match(/class="error"[^>]*>([\s\S]*?)</i)?.[1] ?? "").trim();
  if (/read-only/i.test(text)) {
    console.error(`kooyapedia-edit: the wiki refused — "${slug}" belongs to a read-only project`);
    process.exit(77);
  }
  console.error(`kooyapedia-edit: the wiki refused (${res.status})${err ? `: ${err}` : ""}`);
  process.exit(77);
} else {
  console.error("kooyapedia-edit: get|set|new");
  process.exit(64);
}
