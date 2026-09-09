#!/bin/bash
#
# Read-only lookup into the ECC library (Everything Claude Code) for agents.
#
# Why a wrapper instead of `add_dirs` on the ECC checkout: --add-dir grants
# read AND write, and a bare Read/Glob over 286 skill folders burns a turn's
# context on directory walking. This wrapper answers the two questions an agent
# actually has -- "is there a skill for X?" and "show me that skill" -- in a
# handful of lines, and cannot write anything by construction.
#
#   ecc-lookup.sh search <word> [word...]   ranked hits across skills/agents/rules/commands
#   ecc-lookup.sh list   <type>             every entry of one type, one line each
#   ecc-lookup.sh show   <type>/<name>      the main file (SKILL.md, agent .md, ...)
#   ecc-lookup.sh show   <type>/<name>/<relative file>   a supporting file inside a skill
#   ecc-lookup.sh files  <type>/<name>      supporting files inside a skill
#
# Types: skills, agents, rules, commands. Rules are <lang>/<file>, e.g.
# rules/common/security. Output is capped so one call cannot flood a turn.
set -u
export LC_ALL=C

ECC_ROOT="${ECC_ROOT:-$HOME/.openclaw/ecc}"
MAX_HITS="${ECC_MAX_HITS:-25}"
MAX_BYTES="${ECC_MAX_BYTES:-40000}"

usage() {
  sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

die() { echo "ecc-lookup.sh: $*" >&2; exit 77; }

[ -d "$ECC_ROOT" ] || die "ECC checkout not found at $ECC_ROOT"
[ $# -ge 1 ] || usage
CMD="$1"; shift

# One auditable check: no absolute paths, no parent traversal, no odd bytes.
safe_ref() {
  case "$1" in
    ""|/*|*..*|*[!A-Za-z0-9._/-]*) die "refusing path '$1'" ;;
  esac
}

valid_type() {
  case "$1" in skills|agents|rules|commands) ;; *) die "unknown type '$1' (skills|agents|rules|commands)" ;; esac
}

# Print the frontmatter description of a markdown file, first 220 chars.
desc_of() {
  awk 'NR==1 && $0!="---" {exit} NR>1 && $0=="---" {exit}
       /^description:/ {sub(/^description:[ \t]*/,""); gsub(/^"|"$/,""); print; exit}' "$1" \
    | cut -c1-220
}

# Rules mostly have no frontmatter: fall back to the first heading or line of prose.
rule_desc() {
  local d; d=$(desc_of "$1")
  [ -n "$d" ] && { echo "$d"; return; }
  awk 'NR==1 && $0=="---" {fm=1; next} fm && $0=="---" {fm=0; next} fm {next}
       /^[ \t]*$/ {next} {sub(/^#+[ \t]*/,""); print substr($0,1,220); exit}' "$1"
}

# Emit "type/name<TAB>description" for every entry of one type.
index_type() {
  local t="$1" f n
  case "$t" in
    skills)   for f in "$ECC_ROOT"/skills/*/SKILL.md; do n=$(basename "$(dirname "$f")"); printf 'skills/%s\t%s\n' "$n" "$(desc_of "$f")"; done ;;
    agents)   for f in "$ECC_ROOT"/agents/*.md;       do n=$(basename "$f" .md);          printf 'agents/%s\t%s\n' "$n" "$(desc_of "$f")"; done ;;
    commands) for f in "$ECC_ROOT"/commands/*.md;     do n=$(basename "$f" .md);          printf 'commands/%s\t%s\n' "$n" "$(desc_of "$f")"; done ;;
    rules)    for f in "$ECC_ROOT"/rules/*/*.md;      do n="$(basename "$(dirname "$f")")/$(basename "$f" .md)"; printf 'rules/%s\t%s\n' "$n" "$(rule_desc "$f")"; done ;;
  esac
}

index_all() { for t in skills agents rules commands; do index_type "$t"; done; }

# The index is rebuilt only when the ECC checkout moves to a new commit.
index_cached() {
  local rev cache dir
  rev=$(git -C "$ECC_ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)
  dir="${XDG_CACHE_HOME:-$HOME/.cache}/agora"
  cache="$dir/ecc-index.$rev.tsv"
  if [ ! -s "$cache" ]; then
    mkdir -p "$dir" && index_all > "$cache.tmp" && mv "$cache.tmp" "$cache"
    find "$dir" -name 'ecc-index.*.tsv' ! -name "$(basename "$cache")" -delete 2>/dev/null
  fi
  cat "$cache"
}

case "$CMD" in
  search)
    [ $# -ge 1 ] || die "search needs at least one word"
    # Score = number of query words present in name+description (case-insensitive).
    # Name matches count double so `search tdd` ranks agents/tdd-guide first.
    index_cached | awk -v q="$*" -v max="$MAX_HITS" '
      BEGIN { n = split(tolower(q), w, /[ \t]+/) }
      { line = tolower($0); name = tolower($1); s = 0
        for (i = 1; i <= n; i++) if (w[i] != "") { if (index(name, w[i])) s += 2; else if (index(line, w[i])) s += 1 }
        if (s > 0) print s "\t" $0 }' \
      | sort -t$'\t' -k1,1nr -k2,2 | head -n "$MAX_HITS" \
      | awk -F'\t' '{ printf "%s -- %s\n", $2, $3 }'
    ;;
  list)
    [ $# -eq 1 ] || die "list needs exactly one type"
    valid_type "$1"
    index_cached | grep "^$1/" | awk -F'\t' '{ printf "%s -- %s\n", $1, $2 }'
    ;;
  files)
    [ $# -eq 1 ] || die "files needs <type>/<name>"
    safe_ref "$1"
    case "$1" in skills/*) ;; *) die "files only applies to skills/<name>" ;; esac
    d="$ECC_ROOT/$1"; [ -d "$d" ] || die "no such skill '$1'"
    (cd "$d" && find . -type f | sed 's|^\./||' | sort)
    ;;
  show)
    [ $# -eq 1 ] || die "show needs <type>/<name>[/<file>]"
    safe_ref "$1"
    ref="$1"
    case "$ref" in
      skills/*/*)   f="$ECC_ROOT/$ref" ;;
      skills/*)     f="$ECC_ROOT/$ref/SKILL.md" ;;
      agents/*|commands/*) f="$ECC_ROOT/$ref.md" ;;
      rules/*/*)    f="$ECC_ROOT/$ref.md" ;;
      *) die "ref must start with skills/, agents/, rules/<lang>/ or commands/" ;;
    esac
    [ -f "$f" ] || die "no such entry '$ref'"
    # Refuse anything that is not text; the library is markdown plus a few scripts.
    case "$(file -b --mime-type "$f")" in text/*|application/json|application/x-shellscript|inode/x-empty) ;; *) die "'$ref' is not a text file" ;; esac
    size=$(wc -c < "$f")
    head -c "$MAX_BYTES" "$f"
    [ "$size" -gt "$MAX_BYTES" ] && printf '\n[ecc-lookup: truncated at %s of %s bytes]\n' "$MAX_BYTES" "$size"
    exit 0
    ;;
  *) usage ;;
esac
