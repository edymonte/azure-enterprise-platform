# 7-day personal route — real E2E delivery on Azure (interview edition)

Built with the **"personal route architect"** prompt:

> My goal is **to pass an English interview for an Azure DevOps Consultant role**: to **have deployed a real platform and shipped features from a feature branch to production through PRs, CI, GitOps and smoke tests — and be able to narrate that E2E flow and its trade-offs in ≤ 2 minutes** within **7 days** — not to learn Azure in general.
> I already master **Azure DevOps pipelines, GitHub Actions (GH-200), Terraform, Datadog/Dynatrace and day-to-day Azure work**.
> Build a 7-day route with one daily task of **at most 45 minutes of attention**, a success criterion, and what NOT to do. Redo it until it leads to the goal.

## Rules of the route

- **45 minutes of attention per day.** Long `terraform apply` runs (AKS ≈ 15 min) happen **unattended** — start them, do something else, come back. They don't count.
- **Every change is a commit.** No portal clicks, no `kubectl apply` for the app. The flow is in [E2E-FEATURE-FLOW.md](E2E-FEATURE-FLOW.md).
- **Keep the platform up from day 2 to day 6** and **stop AKS at night** instead of destroying it (rebuilding costs ~30 min of your time every morning):
  ```powershell
  az aks stop  -g rg-mfs-portal-lab -n aks-mfs-portal-lab    # evening — nodes stop billing
  az aks start -g rg-mfs-portal-lab -n aks-mfs-portal-lab    # morning (~5 min)
  ```
  Estimated cost for the week: **≈ US$30–45** of the trial credit (2 × D2s_v5 while running, SQL Basic, Log Analytics capped). **No Front Door** this week (its hourly fee is the expensive part) — the in-cluster PostSync smoke test is the verification; `smoke.yml` skips.
- **10-minute narration at the end of every day:** say out loud, in English, what you shipped and why (record it). That is what turns hands-on into interview answers.
- **Re-plan rule:** a failed criterion moves to the first slot of the next day. Interview in fewer than 7 days? Do days 1, 2, 3 and 7.

## The route

| Day | Task (≤ 45 min attention) | Success criterion | Don't |
|---:|---|---|---|
| 1 | **Foundation.** Lab 00 essentials (trial, providers, settings) → `azp.ps1 bootstrap` → Registro.br NS change → `apply 05-identity` → GitHub variables + `lab` environment (lab 02 step 4) → make the repo **public** and enable branch protection (E2E doc, setup 4). Start `up -Through 30-data` **unattended**. | `.runtime/` generated, delegation submitted, OIDC app with 3 federated credentials, layers 05–30 applied, `main` rejects direct pushes. | Don't read every lab page — only the steps. Don't fix DNS propagation by waiting: move on. |
| 2 | **First deploy.** `apply 40-aks` (unattended) → `render-gitops-values.ps1` (PR) → `build-images.ps1 -Tag v1.0.0` + tags PR → `sql-grant-app-identity.ps1` → `bootstrap-gitops.ps1`. | Argo CD: `portal-dev` and `portal-prod` **Synced/Healthy**; `kubectl -n portal-dev logs job/customer-portal-smoke` → `SMOKE OK version=v1.0.0`. | Don't debug for more than 15 min without writing the hypothesis down (runbook table first). Don't `kubectl edit` to "make it work". |
| 3 | **FEAT-01 — full happy path.** Feature branch → PR → green CI → merge → `app.yml` → deploy PR dev → smoke → promote → deploy PR prod → smoke. Fill the release-evidence block. | Both PostSync jobs log `SMOKE OK version=<sha>`; evidence block complete with links; **narration ≤ 2 min** of the whole flow. | Don't push to `main`. Don't build a second image for prod. |
| 4 | **FEAT-03 + FEAT-04 — quality gates.** A bug blocked by CI before main; then a bad release that passes unit tests but fails the PostSync smoke in dev → revert the deploy PR. | PR shows red → green; dev sync `Failed` by smoke, prod untouched, revert commit restores dev; you can explain **unit vs smoke vs missing integration test**. | Don't promote a release whose smoke failed. Don't use `kubectl rollout undo` (Git wins). |
| 5 | **FEAT-05 — infra change with approval** (+ FEAT-07 rollback drill if time). `portal-qa` via Terraform + GitOps: PR plan comment → merge → `infra` workflow **apply with approval**. | Plan comment shows `1 to add, 0 to destroy`; approval recorded in the `lab` environment; `portal-qa` Healthy. | Don't apply 40-aks from your laptop this time — the pipeline does it. Don't merge a plan you didn't read. |
| 6 | **FEAT-08 — Azure DevOps path** (the client's other team). Manual WIF service connection (lab 09) → variable groups → environment → run `pipelines/azure-devops/app.yml` for a small UI change. | ADO run builds, scans, pushes to ACR and opens the deploy PR; you can compare **GitHub vs ADO** side by side (triggers, identity, approvals). | Don't recreate the infra pipeline in ADO too — app pipeline is enough this week. Don't store any secret in plain pipeline variables. |
| 7 | **Mock + teardown.** Mock interview (30 min): self-intro → 2-min pitch → "walk me through your CI/CD" (tell FEAT-01 + FEAT-04) → 5 random questions from `docs/interview/`. Then `./scripts/azp.ps1 down` (unattended). Gap list. | ≥ 4 of 5 answers ≤ 2 min with structure; the E2E story includes **one failure you caught**; platform destroyed (only 00 and 05 left). | Don't learn new topics. Don't leave AKS running after the week. |

## What this route deliberately skips (and when to do it)

| Skipped this week | Lab phase | Do it… |
|---|---|---|
| Front Door, WAF, public smoke test, Traffic Manager DR | 10 | after the interview, 1 day, then destroy |
| Managed Grafana dashboards, KQL deep dive | 11 | after; alerts still fire via Prometheus rules → e-mail |
| Datadog | 12 | after (14-day trial) |
| Policy Deny exercises, Defender deep dive | 04 | read the lab page instead (15 min) |
| Most game days | 13 | FEAT-04/07 cover the two most interview-relevant ones |

## Redo loop

After day 7 bring the gap list back and ask: *"Redo the route with these gaps: …"*. Each gap becomes a 45-minute task with a criterion; repeat until the mock passes.

## Daily log

| Day | Criterion met? | Evidence link (PR / run) | What failed → redo |
|---:|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
