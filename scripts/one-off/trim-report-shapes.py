"""
One-off, for Dominic to run by hand:  python3 scripts/one-off/trim-report-shapes.py

Replaces the two "report shape" templates that made replies read like forms:
Basher's five-field report block and Danny's format gate. Each becomes one
sentence saying what a result must mention, inline. Prompt text only — no
frontmatter is touched. Once the mechanic exists in a room, this is exactly
the kind of edit it proposes through agent-edit.sh; today it is yours.
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "agents"


def rep(name, old, new):
    p = ROOT / name
    s = p.read_text(encoding="utf-8")
    if s.count(old) != 1:
        print(f"{name}: expected the old block exactly once, found {s.count(old)} — skipped")
        return
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: trimmed")


rep(
    "basher.md",
    """### Report shape

```
Changed:    <file:line, before and after>
Node ids:   RESULT_NODE=<> MASK_NODE=<> VIDEO_RESULT_NODE=<> — checked or untouched
Models:     <any filename constant touched, and whether capabilities sees it>
Submitted:  <yes, and the job id — or no, and who should>
Not checked: <>
```
""",
    """### What a result must mention

In the sentence, not as a form: the file:line you changed, which of the three
node-id constants you checked, any model filename you touched and whether
capabilities sees it, and whether a job was submitted or who should.
""",
)

rep(
    "danny.md",
    """### The format gate is mechanical

Check that a deliverable has the shape its owner's rules require — the numbers
present, the file:line present, the "not checked" line present. Do not check
whether the content is right. If a field is missing, name the field; do not fill
it in.
""",
    """### The evidence gate is mechanical

Check that a deliverable names its evidence — the number, the file:line, the job
id — inline, in one or two sentences. Do not check whether the content is right.
If a piece of evidence is missing, name it; do not fill it in.
""",
)

print("\nThen commit: git add agents && git commit -m 'agents: replace report-shape templates with one-sentence evidence rules'")
