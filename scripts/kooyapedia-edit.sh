#!/bin/bash
#
# Write path into KooyaPedia (Dominic's internal wiki) for agents he has
# granted "kooyapedia-write".
#
# Why a wrapper: the wiki's content is a SQLite database on the Windows side
# that WSL cannot open, and the only safe way in is the wiki's own save route,
# which records every change as a revision the wiki can restore. This script
# validates the slug, pins the base URL, and hands off to a node script that
# speaks the same form the browser's Edit page submits. Articles only — it
# cannot reach files, code, or anything outside the wiki.
#
#   kooyapedia-edit.sh get  <slug>                                   current markdown source
#   kooyapedia-edit.sh set  <slug> --title "<title>" [--space <s>] [--comment "<why>"] < body.md
#   kooyapedia-edit.sh new         --title "<title>" [--space <s>] [--comment "<why>"] < body.md
#
# Read-only projects in the wiki stay read-only (the wiki refuses; exit 77).
# Audience is never touched: an article stays internal unless Dominic sets it
# client-readable himself. Exit 64 usage, 77 refused, 70 unreachable.
set -uo pipefail

AGORA_ROOT=/home/dominickooya/.openclaw/agora
SLUG='^[a-z0-9][a-z0-9._-]{0,120}$'

usage() { sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
refuse() { echo "kooyapedia-edit.sh: $*" >&2; exit 77; }

[ $# -ge 1 ] || usage
CMD="$1"; shift
case "$CMD" in
  get) [ $# -eq 1 ] || usage; [[ "$1" =~ $SLUG ]] || refuse "bad slug '$1'" ;;
  set) [ $# -ge 3 ] || usage; [[ "$1" =~ $SLUG ]] || refuse "bad slug '$1'" ;;
  new) [ $# -ge 2 ] || usage ;;
  *) usage ;;
esac

if [ -z "${KOOYAPEDIA_URL:-}" ]; then
  GW=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
  KOOYAPEDIA_URL="http://${GW:-172.31.224.1}:4711"
fi
export KOOYAPEDIA_URL
exec timeout 30 node "$AGORA_ROOT/scripts/kooyapedia-edit.mjs" "$CMD" "$@"
