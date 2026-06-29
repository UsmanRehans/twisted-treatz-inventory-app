---
name: security-sweep
description: Full cybersecurity audit — auth surface, secrets, injection, dependencies, deploy config
---

Use the zahid subagent (the security engineer; also summonable via /zahid) to
run its full standing audit checklist against the current codebase.

Report findings ranked CRITICAL/HIGH/MEDIUM/LOW/INFO with file:line,
the attack each enables, and the concrete fix. If there are CRITICAL
findings, fix them immediately after reporting (ask first only if the fix
requires changing deployed environment variables or third-party config).
