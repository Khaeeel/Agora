# ERP

Purpose: research and questions about the ERP, and about KooyaPedia, the
team's internal wiki.

## KooyaPedia

KooyaPedia is Dominic's internal developer encyclopedia: runbooks, architecture
notes, provider quirks, project pages. It runs on his Windows machine at
`C:\Projects\Alexandria` (the folder kept its old name) and serves on port 4711.
The content lives in a SQLite database, not in files, so it cannot be read with
Read or Grep. Look it up through the wrapper:

- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh search <words>`
  ranked hits, one line each: slug, title, space, snippet.
- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh show <slug>`
  the article as plain text.
- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh recent`
  what changed lately.

When Dominic says "tignan mo", "check", "basahin", or names KooyaPedia or an
article, look it up first and answer from what you read, citing the slug
inline. Never say your tools are off; if you genuinely cannot reach it, say
what you tried in one clause.
