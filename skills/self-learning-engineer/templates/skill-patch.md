# <patch-id>: <one-line title>

- **Tier:** <1|2|3>
- **Target:** <agent> · `<file path>` · section "<heading>"
- **Approver:** <auto | PM name | human owner>
- **Root cause:** <MISSING_RULE|CONFLICTING_RULE|VAGUE_RULE|WRONG_ROLE|HARNESS>

## Problem
<2–3 sentences: what the agent does, why it hurts delivery.>

## Evidence
| # | Room / msg-id | Session | Excerpt |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |

Damaging instance? <yes — what reached whom | no>

## Cause
<Quote the current skill/harness line(s) responsible, or say what's missing.>

## Diff
```diff
- <old line>
+ <new line>  <!-- sle:<patch-id> -->
```

## Expected effect
- **Metric:** <rubric metric>
- **Baseline:** <current value>
- **Target:** <value>
- **Check date:** <YYYY-MM-DD>

## Risk
<What could get worse. E.g. "agents may over-attach evidence on XS tasks — watch Communication score.">
