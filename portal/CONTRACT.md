# Portal contract (catalog + checkers)

The server, runner and UI are platform-neutral. A repository reuses them (e.g. the AWS twin) by providing its own `catalog/` and `checkers/`. Version: **portal.checker/v1**.

## Track — `catalog/track.json`

```jsonc
{
  "title": "…", "subtitle": "…",
  "environment": {                       // optional; drives the environment probe
    "settingsFile": "config/lab.settings.json",
    "aks": { "resourceGroup": "…", "name": "…" }
  },
  "cycles": [ { "id": 1, "title": "…", "badge": "…", "summary": "…" } ],
  "ranks":  [ { "title": "…", "minXp": 0 } ]
}
```

## Session — `catalog/sessions/C0NN.json`

| Field | Rule |
|---|---|
| `id` | `C` + 3 digits, equal to the file name |
| `number` | contiguous from 1; defines the unlock order |
| `cycle` | an id from `track.cycles` |
| `title`, `topic`, `scenario`, `mission`, `expectedResult`, `cost`, `recovery`, `debrief` | non-empty strings (`debrief` is only sent to the browser after completion) |
| `difficulty` | 1–3 (XP = difficulty × 100; coins = difficulty × 10, ×2 when SOLO, −2 per hint, min 1) |
| `timeMinutes` | ≥ 5 |
| `objectives[]`, `dont[]` | non-empty |
| `steps[]` | `{ title, detail, command? }` — commands are copied, never executed by the portal |
| `hints[]` | ≥ 3, graduated (question → concept → pointer); only revealed on demand |
| `interview` | `{ question, followUps? }` |
| `prerequisites` | `{ platform: [offline\|azure\|aks\|github\|azure-devops], layers: [], notes }` |
| `criteria[]` | `{ id (kebab-case, unique), text }` — every one must pass for completion |
| `checker` | `{ status: "implemented", script: "checkers/<name>.js", timeoutSeconds 5–900, pollSeconds ≥ 0, watch: [repo-relative paths, "/" suffix = directory], watchGit?: bool }` or `{ status: "planned", plan }` |
| `validation` | `{ status: validated \| partial \| pending, notes }`; a planned checker must be `pending` |

## Checker process

- Started as `node <script>` with `cwd` = repository root and environment `PORTAL_REPO_ROOT`, `PORTAL_SESSION_ID`.
- **Read-only.** It may read files, git, and query CLIs/APIs; it must never change resources, files or state, and must never print secret values.
- Prints **one JSON line** on stdout (the last line starting with `{` is used):

```json
{
  "schema": "portal.checker/v1",
  "outcome": "pass | fail | blocked | error",
  "blockedReason": "platform_stopped | missing_prerequisite | auth_error",
  "summary": "one sentence",
  "criteria": [
    { "id": "criterion-id", "status": "pass | fail | skipped", "evidence": "what was observed", "reason": "why it failed / was skipped" }
  ]
}
```

Rules enforced by the runner:

- `pass` must list **every** catalog criterion as `pass`; otherwise the run is an internal `error`.
- Unknown criterion ids, unknown statuses, invalid JSON, a crash, a timeout or a missing `blockedReason` are internal errors (`BLOCKED / validation_error`) — never a pass.
- `blocked` means the environment prevented evaluation; use `skipped` criteria for what could not be checked and still report the criteria that could.
- Evidence is truncated to 4000 characters and passed through redaction.

`checkers/lib/checker.js` implements the contract (`runChecker`, `Result.check/skip`, `az`, `git`, `azureGate`).
