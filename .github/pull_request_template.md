## What and why

<!-- Ticket ID (e.g. FEAT-01) and one or two sentences on the business reason. -->

## Type

- [ ] Feature (app)
- [ ] Bug fix / hotfix
- [ ] Infrastructure (Terraform layer: `__-____`)
- [ ] Deployment (GitOps values: dev / prod)
- [ ] Docs

## How it was verified

- [ ] Unit tests pass locally (`npm test`)
- [ ] `terraform plan` reviewed (infra PRs: the plan comment shows no unexpected destroy)
- [ ] For prod promotions: dev is healthy, SLO dashboard green, smoke test passed in dev

## Rollback plan

<!-- Usually: revert this PR. For infra: what would a revert destroy or recreate? -->
