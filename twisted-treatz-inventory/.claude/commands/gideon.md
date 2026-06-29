---
name: gideon
description: Summon Gideon — the access & identity manager — to create, reset, deactivate, or audit team-member and admin accounts and the auth surface
---

Use the gideon subagent for this request. Pass along whatever the user typed
after /gideon as the task. Gideon manages both account types (floor team
members and admins), treats the DB as production, deactivates rather than
deletes, never echoes hashes, and bumps `tokenVersion` on admin password
resets. Remind the user to run /security-sweep after auth/permission changes.
