# Platform Academy — local learning portal

A local web portal that turns this repository's route into a **gamified, 30-session track**. Open it in a browser on a second monitor; keep VS Code for commands, edits and Git. The portal **watches your evidence** (files, commits, Azure, the cluster) and moves a session forward only when its success criteria are verified — never on a click.

```
┌────────── browser (second monitor) ──────────┐      ┌──────────── VS Code ────────────┐
│ map · current session · live criteria · XP    │      │ terminal · editor · git         │
└───────────────▲───────────────────────────────┘      └───────────────┬─────────────────┘
                │ SSE (live updates)                                  │ you change files,
┌───────────────┴──────── portal server (127.0.0.1) ─────────┐        │ commit, apply…
│ catalog (allow-list) → runner → read-only checkers ────────┼────────┘
│ progress (.data/progress.json) · environment probe · watch │──► az · kubectl · gh · helm · git (read-only)
└────────────────────────────────────────────────────────────┘
```

## Start

Requirements: Node.js ≥ 22 (no `npm install` needed — zero dependencies).

```powershell
npm --prefix portal start
```

Then open **<http://127.0.0.1:4317/>**. Stop with `Ctrl+C`.

**Resume** next day: run the same command. Progress lives in `portal/.data/progress.json` (git-ignored); the portal re-checks the session you were working on as soon as it starts.

## How a session works

**Start** (or **Continue**) opens a launch screen whose progress ring follows the real preflight — session unlocked, environment probed (Azure sign-in, AKS power state), prerequisites, first evidence collected — and then the **lab workspace**: the task on the left (time box countdown, **Check**, **Try later**) and the **evidence console** on the right. The console looks like a terminal but is read-only: it prints every checker run as it happens; your commands run in the VS Code terminal.

1. **Start** the session (the only click that matters — it tells the portal to watch it).
2. Read the scenario, write your hypothesis, work in VS Code. Steps can be ticked for yourself; ticks never complete anything.
3. The checker runs automatically when a watched file changes, when you commit, when the environment changes (e.g. AKS started) and on a polling interval for cloud evidence. You can also press **Check now**.
4. All criteria pass → **COMPLETED**, XP and coins, celebration, next session unlocked.
5. After completion: the debrief appears and you fill the **self-assessment** (English, autonomy, trade-offs). Technical correctness is scored by the checker; the rest is scored separately.

| State | Meaning |
|---|---|
| `AVAILABLE` | Unlocked, not started |
| `IN_PROGRESS` | Started, nothing observed yet (or the check was cancelled) |
| `CHECKING` | A checker run is in flight |
| `FAILED` | Evidence observed and at least one criterion is not met — the exercise itself |
| `BLOCKED` | Cannot be evaluated: `locked` (previous session), `platform_stopped` (e.g. AKS stopped), `missing_prerequisite` (tool, layer or resource), `auth_error` (not signed in / wrong subscription), `validation_error` (the checker failed — not your fault) |
| `COMPLETED` | Every criterion verified once; stays completed even if you later tear the platform down |

**Learning rules built in:** sessions unlock one at a time; hints are graduated and revealed on demand — any hint before completion records the attempt as **AI-assisted** and costs 2 coins (SOLO completions earn double coins); you can also flag "I used AI help" yourself; the debrief (the explained solution) only appears after completion.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORTAL_PORT` | `4317` | Local port |
| `PORTAL_HOST` | `127.0.0.1` | Loopback only (`::1` / `localhost` allowed; anything else is refused) |
| `PORTAL_REPO_ROOT` | repository root | Repository the checkers observe |
| `PORTAL_DATA_DIR` | `portal/.data` | Where progress is stored |
| `PORTAL_POLL_SECONDS` | per checker | Override the polling interval of cloud checkers |
| `PORTAL_ENV_POLL_SECONDS` | `300` | Environment probe interval (Azure sign-in, AKS power state) |
| `PORTAL_MAX_BACKOFF_SECONDS` | `1800` | Cap for exponential backoff after errors |
| `PORTAL_WATCH_DEBOUNCE_MS` | `1500` | Debounce for file events |
| `PORTAL_UNLOCK_ALL` | off | `1` = validation mode: every session unlocked (for testing checkers out of order). Use a separate `PORTAL_DATA_DIR`. |

## Security model

- Binds to loopback only; requests with a foreign `Host` (DNS rebinding) or `Origin` / `Sec-Fetch-Site: cross-site` are refused.
- Every API call needs a per-process random token that only the portal page receives; POST bodies must be JSON (no simple cross-site form posts) and ≤ 4 KB.
- The browser can only name a **session id** from the catalog and one of a fixed set of actions (`start`, `check`, `cancel`, `hint`, `assisted`, `assessment`). It can never send a command, a path or a script.
- Checkers are fixed scripts registered in the catalog, run as separate processes with a timeout; they are **read-only** by contract (no `apply`, no `set`, no `delete`). Their output is validated and secret-looking values are redacted before storage or display. Secret values are never read (e.g. Key Vault checks list names only).
- Strict CSP, no inline scripts, no third-party assets.

## Extending

- Content: `catalog/sessions/C0NN.json` (validated on start — see [CONTRACT.md](CONTRACT.md)).
- A new checker: add `checkers/<id>-<slug>.js` using `checkers/lib/checker.js`, register it in the session (`checker.status: "implemented"`), add a test in `test/`, and set `validation.status` honestly (`pending` → `partial` → `validated`).
- Tests: `npm --prefix portal test`.

## Current limitations

- Automatic checkers exist for **C001** and **C014**; the other 28 sessions have full content and an explicit "checker planned" status, so they cannot be completed until their checker ships (no simulated approvals).
- No embedded terminal (by design in this version).
- One learner per machine; progress is local.
