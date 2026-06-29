---
name: qa
description: Run the full QA pass — tests, type checks, builds, and invariant review of the current diff
---

Use the james subagent (the QA engineer; also summonable via /james) to
verify the current state of the repo.

Have it run the full verification checklist (server tests, server tsc,
client build) and review any uncommitted/unpushed changes against the
project invariants. Report PASS/FAIL with details.
