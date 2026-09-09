# ERP / KOOYAPEDIA

Purpose: research and questions about the ERP, and about KooyaPedia, the
team's internal wiki.

## KooyaPedia

KooyaPedia is Dominic's internal developer encyclopedia: runbooks, architecture
notes, provider quirks, project pages. It runs on his Windows machine at
`C:\Projects\KooyaPedia` and serves on port 4711. The content lives in a
SQLite database, not in files, so it cannot be read with Read or Grep and
cannot be written with Write or Edit. Use the wrappers:

- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh search <words>`
  ranked hits, one line each: slug, title, space, snippet.
- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-lookup.sh show <slug>`
  the article as plain text.
- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-edit.sh get <slug>`
  the article's markdown source, for editing.
- `bash /home/dominickooya/.openclaw/agora/scripts/kooyapedia-edit.sh set <slug> --title "<title>" [--comment "<why>"] < body.md`
  save a new version (the wiki keeps every revision). Needs the
  kooyapedia-write grant; if you do not hold it, say so in accessRequest and
  Dominic gets an Allow button.

When Dominic says "tignan mo", "check", "basahin", or names KooyaPedia or an
article, look it up first and answer from what you read, citing the slug
inline. Never say your tools are off, and never ask anyone to edit an agent's
frontmatter: access is Dominic's to grant, through the buttons the room shows
him when you put the need in accessRequest.
