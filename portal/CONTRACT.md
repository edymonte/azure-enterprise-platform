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

## Schedule — `catalog/schedule.json`

```jsonc
{
  "title": "…", "subtitle": "…",
  "start": "2026-10-18", "lastDay": "2026-11-12", "dailyHours": 3,
  "sprint": { "2026-10-30": ["R1", "R2", "R3"] },          // recovery sprint blocks (catalog/sprint.json); first on their day
  "gitflow": { "2026-11-02": ["G00"] },                    // Git Flow lab missions (catalog/gitflow.json)
  "az400": {
    "prep": "2026-10-18",                                    // one-time preparation item
    "labs": { "00": "2026-10-18" },                          // explicit dates
    "dailyFrom": { "first": "01", "last": "25", "start": "2026-10-19" },  // one lab per day
    "after": { "26": "2026-11-14", "27": "2026-11-21" }     // after lastDay = "After" in the rail
  },
  "platform": [ { "id": "C001", "date": "2026-10-18" } ],   // scheduled sessions are unlocked by the plan
  "replanned": [                                             // history of moves; the last "to" must equal the item's date
    { "kind": "az400", "id": "04", "from": "2026-10-28", "to": "2026-11-01", "decidedAt": "2026-10-29", "reason": "…" }
  ]
}
```

## Guided tracks — `catalog/sprint.json` (R1…R9) and `catalog/gitflow.json` (G00…G99)

Blocks `R1`…`R9`, numbered from 1, each with `day`, `minutes` (≥ 15), `title`, `objective`, `prerequisites.platform`, `files`, `reuse` (`sessions` that must exist, two-digit `az400` lab ids), `recall[]` (`id`, `question`, `answer`), `steps[]` (`id`, `level` = guided | partial | solo | breakfix (break/fix steps are optional for the attempts rule), `title`, `detail`, `command?`, ≥ 2 `hints`, `solution`), `english` (`question`, `followUps?`, `modelAnswer`) and `criteria[]`:

| `verify` | Passes when | Extra fields |
|---|---|---|
| `checker` | the latest run of the block checker reports it `pass` | `owner` = learner \| environment |
| `portal` | the portal recorded the fact | `rule` = recall \| attempts \| english \| feedback |
| `review` | a review with ≥ 20 characters of evidence, a reviewer (`instructor` \| `self`) and verdict `pass` | `owner` |

Both files share this format; `gitflow.json` adds `settings` (Azure DevOps organization, project, repositories, GitHub repository, agent pool) read by `checkers/gitflow.js`, which receives the mission id in `PORTAL_SESSION_ID`. Each track keeps its own section in `progress.json` (`sprint`, `gitflow`).

A block with checker criteria declares `checker: { script: "checkers/<name>.js", timeoutSeconds }`. The script follows `portal.checker/v1` for the block's checker criteria only; it also receives `PORTAL_DATA_DIR` (drills live in `<data dir>/drills/`).

## AZ-400 evidence

The course writes `<PORTAL_AZ400_ROOT>/.state/<labId>/<runId>/validation.json` (schema `2.0.0`: `labId`, `runId`, `status` = `passed` | `partial` | `failed`, five `checkpoints`, `breakFix`, `integration`, `verifiedAt`). The portal keeps the most recent file per lab (by `verifiedAt`), ignores files whose `labId` does not match their folder, and records a completion once when `status` is `passed`.
