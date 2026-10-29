# Platform Academy — local learning portal

A local web portal for a dated study route with two phases: the **AZ-400 course labs** (read from their own repository) and this repository's **30 Azure platform sessions**. It works like a control room: a sticky summary band (labs verified, sessions completed, pace, **Today**), progress bars per exam domain, a **dated schedule** on the left and the selected item's **runbook** on the right — light or dark theme. The portal **watches your evidence** and marks work complete only from it, never on a click: the course's own `Validate.ps1` output for AZ-400 labs, and read-only checkers for platform sessions.

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
npm --prefix portal start                                  # instructions + evidence console
$env:PORTAL_TERMINAL = "1"; npm --prefix portal start      # + a real PowerShell next to the instructions
```

**Terminal (opt-in).** With `PORTAL_TERMINAL=1` the right panel gets **Terminal 1**: a real PowerShell 7 started in the repository folder (no profile). Type a command and press Enter; `cd` and variables persist; prompts such as `Apply …? [y/N]` show up and are answered with the next line; **▶ Terminal** on a step pastes its command (you still press Enter) — a multi-line block (an AZ-400 task, for example) is shown in the terminal first and runs as one block in the same session when you press Enter (Esc cancels); **Restart** kills a stuck command. It is not a full PTY: full-screen programs (vim, less) and masked password prompts do not work — sign in to Azure with `az login` (browser) as usual and never type secrets into it. It is off by default because it lets the portal page run commands on this machine; the page is still protected by loopback binding, the per-process token and Origin checks, and the output is redacted.

**Learn tab.** Every session starts with a *Learn* tab: the concepts explained from zero, a worked example on a *different* case and a glossary. Reading it is free (it is not a hint).

**AZ-400 phase.** Clone the course next to this repository (`../az400-azure-devops-engineer-labs`) or point `PORTAL_AZ400_ROOT` at it. The portal reads `curriculum/lab-content.yml` for the labs (title, scenario, primer, five tasks) and builds each lab's runbook: *Understand → Prepare (Preflight, Setup preview, Context) → 5 tasks → Break/fix → Validate → 50 questions → Cleanup*, with copy-ready commands using your Run ID. Each task shows the course's own **commands**, **positive validation** and **negative validation** (copy or send to the terminal), and the break/fix step has a collapsed **spoiler** with the fault, diagnosis and repair. The **50 exam questions** of labs 01–25 are answered in the portal (`#/quiz/<lab>`): the server grades the attempt (exact set of keys), records the score and only then returns the right answers, every option's rationale and the explanation; a draft is kept in the browser until you submit. **AZ-400 course** (`#/course`) lists every lab by exam domain with its date, cost, step progress, score and verification. Steps are ticked by you; a lab becomes **verified** (XP, celebration) only when the course's `Validate.ps1` writes `.state/<lab>/<run>/validation.json` with `status: passed` — the portal watches that folder. Course content is never copied into this repository.

**Schedule.** `catalog/schedule.json` sets the dates of one single sequence: the recovery sprint blocks, the AZ-400 labs and the platform sessions. A platform session on the schedule is unlocked by the plan; unscheduled ones keep the sequential lock. To re-plan, change the date and add a `replanned` entry (original date, new date, reason): the rail and the item show the move, and "Late" is measured against the current date.

**Recovery sprint.** `catalog/sprint.json` defines six blocks (R1–R6, 8 hours over two days) that come first in the Schedule and in the **Next** button. Each block runs: recall questions answered before any instruction (frozen once recorded) → exercise steps from guided to solo, each with your attempt, graduated hints and a solution that opens only after the attempt → evidence → a 60–90 second English answer → feedback with separate technical, autonomy and English scores. A block completes only when every criterion passes: **automatic** criteria come from the block's read-only checker (`checkers/sprint-r*.js`), **portal** criteria from what you recorded, and **manual review** criteria from an explicit review with pasted evidence and a named reviewer (instructor or self). Hints or solutions opened before completion make the block AI-assisted. Logged time is shown next to the estimate but never completes anything; the sprint awards no XP and never completes a platform session or an AZ-400 lab — those keep their own checker or `Validate.ps1`, and they show the sprint evidence as a reference. Environment, tool and access blockers are recorded apart from technical mistakes. Drills (pipelines written from a blank file) live in `portal/.data/drills/` (git-ignored).

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
| `PORTAL_TERMINAL` | off | `1` = real PowerShell in the page (see above) |
| `PORTAL_AZ400_ROOT` | `../az400-azure-devops-engineer-labs` | The AZ-400 course repository (read-only: catalog + evidence) |

## Security model

- Binds to loopback only; requests with a foreign `Host` (DNS rebinding) or `Origin` / `Sec-Fetch-Site: cross-site` are refused.
- Every API call needs a per-process random token that only the portal page receives; POST bodies must be JSON (no simple cross-site form posts) and ≤ 4 KB.
- The browser can only name a **session id** from the catalog and one of a fixed set of actions (`start`, `check`, `cancel`, `hint`, `assisted`, `assessment`). It can never send a command, a path or a script — **except** through the opt-in terminal (`PORTAL_TERMINAL=1`), a deliberate trade-off chosen by the learner: one command line (or one reviewed multi-line block, sent only by an explicit Enter) at a time, into one PowerShell in the repository, behind the same token and origin checks.
- Checkers are fixed scripts registered in the catalog, run as separate processes with a timeout; they are **read-only** by contract (no `apply`, no `set`, no `delete`). Their output is validated and secret-looking values are redacted before storage or display. Secret values are never read (e.g. Key Vault checks list names only).
- Strict CSP, no inline scripts, no third-party assets.

## Extending

- Content: `catalog/sessions/C0NN.json` (validated on start — see [CONTRACT.md](CONTRACT.md)).
- A new checker: add `checkers/<id>-<slug>.js` using `checkers/lib/checker.js`, register it in the session (`checker.status: "implemented"`), add a test in `test/`, and set `validation.status` honestly (`pending` → `partial` → `validated`).
- Tests: `npm --prefix portal test`.

## Current limitations

- Platform sessions: automatic checkers exist for **C001** and **C014**; the other 28 have full content and an explicit "checker planned" status, so they cannot be completed until their checker ships (no simulated approvals).
- AZ-400: completion depends on the course's own validation; the portal does not judge the course content itself.
- The terminal is not a full PTY (see above).
- One learner per machine; progress is local (progress made in other tools, e.g. a hosted planning page, is not imported).
