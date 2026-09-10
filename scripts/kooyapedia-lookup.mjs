// The fetch-and-flatten half of scripts/kooyapedia-lookup.sh. GET only.
//
// Why fallbacks exist: KooyaPedia FTS matches whole tokens. "Alexandra" does
// not hit "Alex" / "HelloAlex", so an agent that only exact-searches will
// falsely report "walang entry" for a project Dominic just named. When exact
// search is empty we stem, alias, and suggest — and `projects` lists the wiki
// + C:\Projects roster so a name can be resolved against reality.
const BASE = (process.env.KOOYAPEDIA_URL ?? "http://172.31.224.1:4711").replace(/\/$/, "");
const MAX_BYTES = Number(process.env.KOOYAPEDIA_MAX_BYTES ?? 40_000);
const DISK_PROJECTS = process.env.KOOYAPEDIA_DISK_PROJECTS ?? "/mnt/c/Projects";
const [cmd, ...rest] = process.argv.slice(2);

/** Informal names Dominic (and agents) use → queries that actually hit the wiki. */
const ALIASES = {
  alexandra: ["Alex", "HelloAlex", "Hello Alex", "HelloAlex.ai"],
  alexandria: ["KooyaPedia", "Alex", "HelloAlex", "Hello Alex"],
  alex: ["HelloAlex", "Hello Alex", "HelloAlex.ai"],
  helloalex: ["HelloAlex", "Hello Alex", "HelloAlex.ai", "HelloAlex BE"],
  "hello alex": ["HelloAlex", "Hello Alex", "HelloAlex.ai"],
  callisto: ["Callisto", "HelloAlex", "HelloAlex Bot"],
  calisto: ["Callisto", "HelloAlex"],
  bland: ["Bland", "HelloAlex"],
  erasr: ["erasr", "Erasr"],
  "18fund": ["18Fund", "18Fund CRM"],
  shalevet: ["Shalevet", "SHALEVET"],
};

async function get(path) {
  let res;
  try {
    res = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    console.error(`kooyapedia-lookup: cannot reach ${BASE} (${err.message}). It is down. Bring it up yourself: bash /home/dominickooya/agora/scripts/kooyapedia-start.sh, then retry.`);
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

function stripHtml(s) {
  return decode(String(s ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function printHits(results, limit = 25) {
  for (const r of results.slice(0, limit)) {
    console.log(
      `${r.slug} · ${stripHtml(r.titleHtml) || r.title} · ${r.space ?? ""} · ${stripHtml(r.bodyHtml ?? r.snippet ?? "")}`.slice(0, 300),
    );
  }
}

async function searchApi(q) {
  const data = await (await get("/api/search?q=" + encodeURIComponent(q))).json();
  if (data.error) {
    console.error(`kooyapedia-lookup: ${data.error}`);
    process.exit(77);
  }
  return data.results ?? [];
}

async function suggestApi(q) {
  try {
    const data = await (await get("/api/suggest?q=" + encodeURIComponent(q))).json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Progressive prefixes so "Alexandra" can still reach "Alex". */
function stems(q) {
  const raw = q.trim();
  const out = [];
  // Whole words and CamelCase splits.
  for (const part of raw.split(/[\s_/.-]+/).filter(Boolean)) {
    out.push(part);
    for (let n = part.length - 1; n >= 4; n--) out.push(part.slice(0, n));
  }
  // Unique, longest first, drop the original exact string (already tried).
  const seen = new Set([raw.toLowerCase()]);
  return out.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k) || s.length < 3) return false;
    seen.add(k);
    return true;
  });
}

function aliasesFor(q) {
  const key = q.trim().toLowerCase();
  return ALIASES[key] ?? [];
}

async function wikiProjects() {
  const html = await (await get("/")).text();
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/project=([^"&]+)/g)) {
    const name = decodeURIComponent(m[1].replace(/\+/g, " "));
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function diskProjects() {
  const { readdir } = await import("node:fs/promises");
  try {
    const names = await readdir(DISK_PROJECTS, { withFileTypes: true });
    return names
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error(`kooyapedia-lookup: cannot list ${DISK_PROJECTS} (${err.message})`);
    return [];
  }
}

function scoreName(needle, hay) {
  const n = needle.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const h = hay.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!n || !h) return 0;
  if (h === n) return 100;
  if (h.includes(n) || n.includes(h)) return 80;
  // shared prefix length
  let i = 0;
  while (i < n.length && i < h.length && n[i] === h[i]) i++;
  if (i >= 4) return 40 + i;
  return 0;
}

function rankNames(needle, names) {
  return names
    .map((name) => ({ name, score: scoreName(needle, name) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

if (cmd === "search") {
  const q = rest.join(" ");
  const exact = await searchApi(q);
  if (exact.length) {
    printHits(exact);
    process.exit(0);
  }

  console.log(`no exact articles for "${q}" — trying stems, aliases, and suggest`);

  const tried = new Set([q.toLowerCase()]);
  let found = false;

  for (const alt of [...aliasesFor(q), ...stems(q)]) {
    const key = alt.toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);
    const hits = await searchApi(alt);
    if (!hits.length) continue;
    console.log(`--- near match via "${alt}" ---`);
    printHits(hits);
    found = true;
    break;
  }

  if (!found) {
    const suggestions = await suggestApi(q);
    // suggest is substring LIKE — also try stems there
    let sug = suggestions;
    if (!sug.length) {
      for (const alt of stems(q)) {
        sug = await suggestApi(alt);
        if (sug.length) {
          console.log(`--- title suggest via "${alt}" ---`);
          break;
        }
      }
    } else {
      console.log(`--- title suggest for "${q}" ---`);
    }
    if (sug.length) {
      for (const r of sug.slice(0, 15)) {
        console.log(`${r.slug} · ${r.title} · ${r.space ?? ""}`);
      }
      found = true;
    }
  }

  // Always surface project roster hits so "Alexandra" can land on HelloAlex.ai
  // / HelloAlex_BE even when article FTS stays cold.
  const [wiki, disk] = await Promise.all([wikiProjects(), diskProjects()]);
  const wikiHits = rankNames(q, wiki);
  const diskHits = rankNames(q, disk);
  // Also rank aliases against project names
  for (const alt of aliasesFor(q)) {
    for (const hit of rankNames(alt, wiki)) {
      if (!wikiHits.some((h) => h.name === hit.name)) wikiHits.push(hit);
    }
    for (const hit of rankNames(alt, disk)) {
      if (!diskHits.some((h) => h.name === hit.name)) diskHits.push(hit);
    }
  }
  wikiHits.sort((a, b) => b.score - a.score);
  diskHits.sort((a, b) => b.score - a.score);

  if (wikiHits.length || diskHits.length) {
    console.log(`--- project roster (not an exact article title) ---`);
    for (const h of wikiHits.slice(0, 8)) console.log(`wiki project · ${h.name}`);
    for (const h of diskHits.slice(0, 8)) console.log(`disk folder · ${DISK_PROJECTS}/${h.name}`);
    found = true;
  }

  if (!found) {
    console.log(`still nothing for "${q}". Run: kooyapedia-lookup.sh projects`);
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
} else if (cmd === "projects") {
  // Optional filter: `projects Alexandra` ranks the roster against that name.
  const filter = rest.join(" ").trim();
  const [wiki, disk] = await Promise.all([wikiProjects(), diskProjects()]);
  if (filter) {
    console.log(`# matching "${filter}"`);
    const w = rankNames(filter, wiki);
    const d = rankNames(filter, disk);
    for (const alt of aliasesFor(filter)) {
      for (const hit of rankNames(alt, wiki)) if (!w.some((x) => x.name === hit.name)) w.push(hit);
      for (const hit of rankNames(alt, disk)) if (!d.some((x) => x.name === hit.name)) d.push(hit);
    }
    w.sort((a, b) => b.score - a.score);
    d.sort((a, b) => b.score - a.score);
    if (!w.length && !d.length) {
      console.log("(no fuzzy hits)");
    } else {
      for (const h of w) console.log(`wiki · ${h.name}`);
      for (const h of d) console.log(`disk · ${DISK_PROJECTS}/${h.name}`);
    }
    console.log("# full roster");
  }
  console.log("# wiki projects");
  for (const p of wiki) console.log(`wiki · ${p}`);
  console.log(`# disk folders under ${DISK_PROJECTS}`);
  for (const p of disk) console.log(`disk · ${DISK_PROJECTS}/${p}`);
} else {
  console.error("kooyapedia-lookup: search|show|recent|projects");
  process.exit(64);
}
