---
name: james
description: Summon James — the QA engineer — to verify a change (full test suite, type-checks, client build, and an adversarial diff review against the project invariants). Same agent as /qa.
---

Use the james subagent for this request. Pass along whatever the user typed
after /james as the task. James runs the full verification checklist (server
tests, server tsc, client build) and adversarially reviews the diff against
the project invariants, then reports PASS/FAIL with details. Never reports
PASS if a step was skipped.
