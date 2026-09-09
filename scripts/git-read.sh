#!/bin/bash
#
# Read-only git for agents.
#
# Why a wrapper instead of granting `Bash(git ...)`: permission patterns match
# the literal command string, so `Bash(git status:*)` misses `git -C <path>
# status`, and the pattern loose enough to catch it (`git -C:*`) would equally
# permit `git -C <path> checkout`. An allowlist in one auditable file makes a
# write impossible by construction rather than by pattern luck.
#
#   git-read.sh <subcommand> [args...]
#
# Refuses anything not on the list, and refuses flags that let git write or
# execute (-c, --exec-path, --upload-pack, etc).
set -u

REPO="${AGORA_GIT_REPO:-$HOME/helloalex2}"

ALLOWED="status diff log show blame ls-files rev-parse branch describe shortlog
         diff-tree name-rev tag remote config-get"

usage() {
  echo "git-read.sh: read-only git."
  echo "allowed: $(echo $ALLOWED | tr '\n' ' ')"
  exit 64
}

[ $# -ge 1 ] || usage
SUB="$1"; shift

case " $(echo $ALLOWED | tr '\n' ' ') " in
  *" $SUB "*) ;;
  *)
    echo "git-read.sh: '$SUB' is not permitted. This wrapper is read-only." >&2
    echo "allowed: $(echo $ALLOWED | tr '\n' ' ')" >&2
    exit 77
    ;;
esac

# Block argument forms that turn a read into a write or an exec.
for a in "$@"; do
  case "$a" in
    -c|--exec-path=*|--upload-pack=*|--receive-pack=*|-u|--update|--force|-f)
      echo "git-read.sh: argument '$a' is not permitted." >&2
      exit 77
      ;;
  esac
done

# `config-get` is spelled separately so plain `config` (which can write) is not
# on the allowlist at all.
if [ "$SUB" = "config-get" ]; then
  exec git -C "$REPO" config --get "$@"
fi

# --no-pager: a pager would hang a non-interactive process forever.
exec git --no-pager -C "$REPO" "$SUB" "$@"
