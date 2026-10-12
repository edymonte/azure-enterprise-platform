# Phase 08 — CI/CD with GitHub Actions (4 h)

## 🎯 Goal

Automate the three flows with GitHub Actions, with no cloud secret at all:

| Workflow | Trigger | Does | Credential |
|---|---|---|---|
| `ci.yml` | every PR / push | fmt + validate for the 9 layers, `npm test`, `helm lint`, Trivy (IaC) | none |
| `infra.yml` | PR touching `infra/**` | `terraform plan` per layer + PR comment | OIDC subject `pull_request` |
| `infra.yml` | manual | `plan`/`apply`/`destroy` of one layer, **with approval** | OIDC subject `environment:lab` |
| `app.yml` | push to `app/**` | test → build → scan → push ACR → **PR** bumping the dev tag | OIDC `environment:lab` |
| `app.yml` | manual (`promote_to_prod`) | PR copying dev tags to prod | none |

You hold GH-200, so the focus is not syntax but **design**: privilege separation, gates, and a pipeline that never touches the cluster.

## 🛠️ Steps

1. Confirm the variables and the `lab` environment (phase 02, step 4).
2. Open a PR that changes something harmless in `infra/` (e.g. a comment). Watch the `plan` jobs comment the summary on the PR.
3. *Actions → infra → Run workflow* with `layer=10-foundation`, `action=plan`. The job waits for **your approval** on the `lab` environment.
4. Change the text in `app/customer-portal/web/index.html` and merge to `main`. Follow it: build → Trivy → push → **automatic PR** `deploy(dev): ...`. Merge it and watch Argo CD sync `portal-dev`.
5. *Actions → app → Run workflow* with `promote_to_prod = true` → PR for prod.

## ✅ Checkpoint

- [ ] Infra PRs get a comment with `Plan: ...` for each layer.
- [ ] Manual runs ask for approval before running.
- [ ] Deploy to dev and promotion to prod happen **only by merging PRs**.

## 💥 Break it

Remove `id-token: write` from the `permissions` block in `infra.yml` and run the manual plan.

- **Observation:** `Unable to get ACTIONS_ID_TOKEN_REQUEST_URL` or a login failure.
- **Concept:** without that permission the runner cannot request an OIDC token. It is an explicit security *opt-in*.

## 🎤 Interview

1. Why does the app pipeline open a PR instead of deploying to the cluster?
2. How would you prevent a PR from a fork from running `apply`?
3. Where do approval gates live, and why on the *environment* rather than in the workflow?
4. What does Trivy in `config` mode find that `terraform validate` does not?
