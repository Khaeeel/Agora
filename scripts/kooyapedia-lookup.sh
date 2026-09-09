#!/bin/bash
#
# Read-only lookup into KooyaPedia (Dominic's internal wiki) for agents.
#
# Why a wrapper: the wiki's content is a SQLite database on the Windows side,
# in WAL mode, which cannot be read through /mnt/c from WSL (disk I/O error),
# and Read/Grep would not help anyway. The wiki serves HTTP on port 4711, so
# this script asks it over the network — GET only, nothing is ever written —
# and prints plain text capped so one call cannot flood a turn.
#
#   kooyapedia-lookup.sh search <word> [word...]   ranked hits: slug · title · space · snippet
#   kooyapedia-lookup.sh show <slug>               one article as plain text
#   kooyapedia-lookup.sh recent                    articles linked from the front page
#
# The base URL is the Windows host as seen from WSL (the default gateway),
# overridable with KOOYAPEDIA_URL. Exit 64 usage, 77 refused, 70 unreachable.
set -uo pipefail

AGORA_ROOT=/home/dominickooya/.openclaw/agora
SLUG='^[a-z0-9][a-z0-9._-]{0,120}$'

usage() { sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
refuse() { echo "kooyapedia-lookup.sh: $*" >&2; exit 77; }

[ $# -ge 1 ] || usage
CMD="$1"; shift
case "$CMD" in
  search) [ $# -ge 1 ] || refuse "search needs at least one word" ;;
  show)   [ $# -eq 1 ] || usage; [[ "$1" =~ $SLUG ]] || refuse "bad slug '$1'" ;;
  recent) [ $# -eq 0 ] || usage ;;
  *) usage ;;
esac

if [ -z "${KOOYAPEDIA_URL:-}" ]; then
  GW=$(ip route 2>/dev/null | awk '/default/ {print $3; exit}')
  KOOYAPEDIA_URL="http://${GW:-172.31.224.1}:4711"
fi
export KOOYAPEDIA_URL
exec timeout 30 node "$AGORA_ROOT/scripts/kooyapedia-lookup.mjs" "$CMD" "$@"
