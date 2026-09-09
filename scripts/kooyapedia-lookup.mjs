// The fetch-and-flatten half of scripts/kooyapedia-lookup.sh. GET only.
const BASE = (process.env.KOOYAPEDIA_URL ?? "http://172.31.224.1:4711").replace(/\/$/, "");
const MAX_BYTES = Number(process.env.KOOYAPEDIA_MAX_BYTES ?? 40_000);
const [cmd, ...rest] = process.argv.slice(2);

async function get(path) {
  let res;
  try {
    res = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    console.error(`kooyapedia-lookup: cannot reach ${BASE} (${err.message}). Is KooyaPedia running on the Windows side (npm start in C:/Projects/KooyaPedia)?`);
    process.exit(70);
  }
  if (!res.ok) {
    console.error(`kooyapedia-lookup: ${res.status} for ${path}`);
    process.exit(res.status === 404 ? 77 : 70);
  }
  return res;
}

const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(parseInt(e[1] === "x" ? e.slice(2) : e.slice(1), e[1] === "x" ? 16 : 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsaquo: "›", lsaquo: "‹", raquo: "»", laquo: "«", mdash: "—", ndash: "–", hellip: "…" }[e.toLowerCase()] ?? m;
  });

/** HTML to readable text: drop chrome, keep headings and paragraphs on their own lines. */
function flatten(html) {
  let h = html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i);
  if (main) h = main[2];
  h = h
    .replace(/<\/(h[1-6]|p|li|tr|div|section|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(h[1-6])\b[^>]*>/gi, (m, t) => "\n" + "#".repeat(Number(t[1])) + " ")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  const text = decode(h).replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  // The tab strip and breadcrumb sit above the article title; start at the h1.
  const at = text.search(/^# /m);
  return at > 0 ? text.slice(at) : text;
}

function cap(text) {
  if (text.length <= MAX_BYTES) return text;
  return text.slice(0, MAX_BYTES) + `\n[kooyapedia-lookup: truncated at ${MAX_BYTES} of ${text.length} chars]`;
}

if (cmd === "search") {
  const q = rest.join(" ");
  const data = await (await get("/api/search?q=" + encodeURIComponent(q))).json();
  if (data.error) { console.error(`kooyapedia-lookup: ${data.error}`); process.exit(77); }
  if (!data.results?.length) { console.log(`no articles match "${q}"`); process.exit(0); }
  const strip = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  for (const r of data.results.slice(0, 25)) {
    console.log(`${r.slug} · ${strip(r.titleHtml) || r.title} · ${r.space ?? ""} · ${strip(r.bodyHtml ?? r.snippet ?? "")}`.slice(0, 300));
  }
} else if (cmd === "show") {
  const html = await (await get("/wiki/" + encodeURIComponent(rest[0]))).text();
  console.log(cap(flatten(html)));
} else if (cmd === "recent") {
  const html = await (await get("/")).text();
  const seen = new Set();
  for (const m of html.matchAll(/href="\/wiki\/([^"?#]+)"[^>]*>([^<]{1,120})</g)) {
    const slug = decodeURIComponent(m[1]);
    if (seen.has(slug)) continue;
    seen.add(slug);
    console.log(`${slug} · ${decode(m[2]).trim()}`);
    if (seen.size >= 40) break;
  }
  if (!seen.size) console.log("no article links on the front page");
} else {
  console.error("kooyapedia-lookup: search|show|recent");
  process.exit(64);
}
