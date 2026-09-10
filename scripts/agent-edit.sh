#!/bin/bash
#
# Guarded prompt editor for agents — the mechanic's only write path.
#
# Why a wrapper and not Write/Edit: every claude spawn's cwd is the agora repo,
# so a bare Write grant would reach scripts/, apps/ and .env. This script is the
# whole boundary. It accepts a fixed set of subcommands, validates every
# argument to a slug, pins the repo path, and hands off to a TypeScript tool
# that shares the server's own markdown parser — so the editor and the loader
# cannot drift apart.
#
#   agent-edit.sh show       <id> <section>             print the section
#   agent-edit.sh preview    <id> <section>  < body     diff only, writes nothing
#   agent-edit.sh set        <id> <section>  < body     write + one git commit
#   agent-edit.sh show-rules <slug>                     print a room's rules file
#   agent-edit.sh set-rules  <slug>          < body     write + one git commit
#   agent-edit.sh undo       <id>                       revert this file's last agent edit
#   agent-edit.sh log        <id>                       recent commits on the file
#   any of the above may end with  --as <agent-id>      who to record as author
#
# WHAT IT MAY DO: change the Instructions or Personality section of an agent
# file, or the body of a _rules-<slug>.md, and commit that change.
# WHAT IT MAY NOT: touch frontmatter (tools, allow, add_dirs, mcp, model), Name,
# Role or Description; create or delete agents; reach any file outside agents/.
# The TS tool re-checks all of that byte for byte before it writes.
set -uo pipefail

AGORA_ROOT=/home/dominickooya/agora   # pinned on purpose, never from env
SLUG='^[a-z0-9][a-z0-9-]{0,40}$'

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 64; }
refuse() { echo "agent-edit.sh: $*" >&2; exit 77; }

[ $# -ge 1 ] || usage
CMD="$1"; shift

# Optional trailing "--as <id>", validated like everything else.
AS=""
if [ $# -ge 2 ] && [ "${@: -2:1}" = "--as" ]; then
  AS="${@: -1}"
  [[ "$AS" =~ $SLUG ]] || refuse "bad --as '$AS'"
  set -- "${@:1:$#-2}"
fi

case "$CMD" in
  show|preview|set)
    [ $# -eq 2 ] || usage
    [[ "$1" =~ $SLUG ]] || refuse "bad agent id '$1'"
    case "$2" in instructions|personality) ;; *) refuse "section must be instructions or personality (never frontmatter, name, role or description)";; esac
    ;;
  show-rules|set-rules)
    [ $# -eq 1 ] || usage
    [[ "$1" =~ $SLUG ]] || refuse "bad room slug '$1'"
    ;;
  undo|log)
    [ $# -eq 1 ] || usage
    [[ "$1" =~ $SLUG ]] || refuse "bad agent id '$1'"
    ;;
  *) usage ;;
esac

cd "$AGORA_ROOT" || { echo "agent-edit.sh: cannot cd to $AGORA_ROOT" >&2; exit 70; }
[ -d .git ] || { echo "agent-edit.sh: $AGORA_ROOT is not a git repo; refusing to edit without history" >&2; exit 70; }

# 60s is generous for a string splice plus a commit, and well under a turn.
exec timeout 60 node --env-file-if-exists=.env apps/server/src/tools/agent-edit.ts "$CMD" "$@" ${AS:+--as "$AS"}
