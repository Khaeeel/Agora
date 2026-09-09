"""
One-off, for Dominic to run by hand:  python3 scripts/one-off/grant-ecc-lookup.py

Adds the read-only ECC lookup wrapper to the `allow:` list of every agent that
already holds Bash. Left to a human on purpose: granting capability is the one
thing no agent, and no automated session, is allowed to do in this repo.
Idempotent — an agent that already has the grant is skipped.
"""
import re
import pathlib

GRANT = '"Bash(bash /home/dominickooya/.openclaw/agora/scripts/ecc-lookup.sh:*)"'
AGENTS = "berlin denver rio tokyo ana collapse yatoro linus basher livingston rusty topson ceb saul".split()
ROOT = pathlib.Path(__file__).resolve().parents[2] / "agents"

for a in AGENTS:
    p = ROOT / f"{a}.md"
    if not p.exists():
        print(f"{a}: no such agent, skipped")
        continue
    raw = p.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    if not m:
        print(f"{a}: no frontmatter, skipped")
        continue
    fm = m.group(1)
    if "ecc-lookup.sh" in fm:
        print(f"{a}: already granted")
        continue
    if "tools:" not in fm or '"Bash"' not in fm:
        print(f"{a}: no Bash tool, skipped")
        continue
    lines = fm.split("\n")
    out, i, done = [], 0, False
    while i < len(lines):
        ln = lines[i]
        if not done and re.match(r"^allow:\s*\[", ln):
            block, j = [ln], i
            while "]" not in block[-1]:
                j += 1
                block.append(lines[j])
            last = block[-1]
            k = last.rindex("]")
            before = last[:k].rstrip()
            sep = "" if before.endswith("[") or before.endswith(",") else ","
            if len(block) == 1:
                block[-1] = before + sep + " " + GRANT + last[k:]
            else:
                block[-1] = before + sep + "\n  " + GRANT + ",\n" + last[k:]
            out.extend(block)
            i, done = j + 1, True
            continue
        if not done and re.match(r"^allow:\s*$", ln):
            out.append(ln)
            i += 1
            while i < len(lines) and re.match(r"^\s+-\s", lines[i]):
                out.append(lines[i])
                i += 1
            out.append("  - " + GRANT)
            done = True
            continue
        out.append(ln)
        i += 1
    if not done:
        out.append(f"allow: [{GRANT}]")
    p.write_text("---\n" + "\n".join(out) + "\n---\n" + raw[m.end():], encoding="utf-8")
    print(f"{a}: granted")

print("\nNow verify:  curl -s http://127.0.0.1:8787/api/state | grep -c ecc-lookup")
print("Then commit: git add agents && git commit -m 'agents: grant ecc-lookup.sh to Bash-holding agents'")
