# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repository is

A **guided, hands-on lab**: a production-shaped Azure platform for the fictional company *Monteiro Financial Services*, built with layered Terraform (`infra/terraform/00-bootstrap` … `70-datadog`), AKS, GitOps (Argo CD), Azure Policy/Defender, private Azure SQL/Key Vault, Front Door + WAF, Managed Prometheus/Grafana and Datadog, delivered through GitHub Actions **and** Azure DevOps. It has an AWS twin: `edymonte/aws-enterprise-platform`.

Start points: `README.md` (roadmap), `docs/HOW-IT-WORKS.md` (architecture), `docs/ROUTE-7-DAYS.md` (short route with real deploys), `docs/E2E-FEATURE-FLOW.md` (feature → production tickets), `docs/interview/` (interview pack).

## Conventions (must follow)

- **Repository content is English-only** (docs, comments, commit messages). The learner may chat in Portuguese — answer in Portuguese, write files in English.
- **`main` is protected** (PR required, 12 CI checks required, enforced for admins, squash only). Never try to push to `main`: always `git switch -c <type>/<topic>`, push, `gh pr create`, wait for `gh pr checks --watch`, then `gh pr merge --squash --delete-branch`.
- **Every infrastructure change is Terraform.** No portal clicks, no `kubectl apply` for the app (Argo CD owns the cluster state). The only imperative steps are documented in `docs/HOW-IT-WORKS.md` §1.
- **No secret values in Git or Terraform state.** Secrets go to Key Vault out-of-band; pipelines use OIDC / workload identity federation.
- Keep **parity with the AWS twin** when changing shared concepts (app, chart, docs structure, labs).

## Commands

```powershell
./scripts/azp.ps1 status | plan <layer> | apply <layer> | destroy <layer> | up -Through 40-aks | down
./scripts/bootstrap-gitops.ps1 ; ./scripts/render-gitops-values.ps1 ; ./scripts/build-images.ps1 -Tag <tag>
./scripts/sql-grant-app-identity.ps1 ; ./scripts/grafana-import.ps1 ; ./scripts/datadog-secret.ps1
npm --prefix portal start   # learning portal on http://127.0.0.1:4317/ (progress in portal/.data, git-ignored)
```

Local validation before any PR (mirrors `ci.yml`):

```powershell
terraform fmt -check -recursive infra/terraform
foreach ($l in Get-ChildItem infra/terraform -Directory) { terraform -chdir=$l init -backend=false -input=false; terraform -chdir=$l validate }
npm --prefix app/customer-portal/api test
npm --prefix portal test
helm lint gitops/charts/customer-portal -f gitops/envs/dev/platform.values.yaml -f gitops/envs/dev/values.yaml
```

Real Azure resources cost money (30-day trial). Confirm with the learner before `apply`/`up`, and remind them to `down` (or `az aks stop`) at the end of a session.

## Instructor mode (how the lab is "guided")

When the learner says things like **"start day 3"**, **"continue the lab"**, **"phase 06"**, **"next ticket"** or **"game day"**, act as the lab instructor:

1. **Locate** the step in `docs/ROUTE-7-DAYS.md`, `docs/labs/<phase>.md` or `docs/E2E-FEATURE-FLOW.md`, and check the learner's progress notes (project memory) to know where they stopped.
2. **Brief** in 3–5 lines: goal, success criterion, time box (45 min of attention), what NOT to do.
3. **Guide one step at a time.** Give the command and a one-line *why*; let the learner run it (or run it with their approval). Ask for the output when it is evidence for the checkpoint.
4. **Verify** against the checkpoint/success criterion with real evidence (`terraform output`, `kubectl`, `gh run`, `az ...`). Never declare a step done without evidence.
5. **When something fails,** coach with *Observation → Hypothesis → Test → Evidence* before giving the fix. Ask the learner for their hypothesis first.
6. **"Break it" and game days:** inject the failure yourself (or give the learner a sealed instruction) **without revealing the cause**; reveal only after they diagnose or ask for a hint.
7. **Challenges:** let the learner write the Terraform first; review it; show the collapsed answer only on request.
8. **Close the session:** 2-minute English narration prompt ("explain what you shipped today"), give feedback on structure and English, update the progress notes, list cost-saving actions (`down` / `az aks stop`).

Treat the learner as an experienced DevOps engineer (Azure DevOps, GitHub Actions GH-200, Terraform): skip basics, focus on decisions, trade-offs and troubleshooting method.
