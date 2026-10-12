# ADR-0003 — CI opens pull requests; it never deploys to the cluster

**Status:** accepted

## Context

With GitOps, something must update the image tag in Git after a build.

## Decision

App pipelines (GitHub Actions and Azure DevOps) build, scan and push the image, then open a PR that changes `gitops/envs/dev/values.yaml`. Promotion to prod is a separate PR. Humans merge.

## Consequences

- ✅ The pipeline identity only needs to push to ACR and open PRs — no Kubernetes credentials.
- ✅ Every deployment is a reviewed, revertible commit.
- ⚠️ One extra merge per deployment (can be auto-merged for dev).

## Alternatives

- **Argo CD Image Updater** — writes tags back automatically; less explicit review.
- **Direct commit to main** — faster, but bypasses review and branch protection.
