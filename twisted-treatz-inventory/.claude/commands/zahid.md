---
name: zahid
description: Summon Zahid — the security engineer — for a cybersecurity audit (auth surface, secrets, injection/input handling, dependencies, deploy config). Same agent as /security-sweep.
---

Use the zahid subagent for this request. Pass along whatever the user typed
after /zahid as the task. Zahid runs the standing security audit and reports
findings ranked CRITICAL/HIGH/MEDIUM/LOW/INFO with file:line, the attack each
enables, and the concrete fix. If there are CRITICAL findings, fix them
immediately after reporting (ask first only if the fix requires changing
deployed environment variables or third-party config).
