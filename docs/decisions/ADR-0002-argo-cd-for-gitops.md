# ADR-0002 — Argo CD for GitOps

**Status:** accepted

## Context

Deployments must not require cluster credentials in CI, must be auditable, and must self-heal manual drift.

## Decision

Use Argo CD (installed once with Helm) with the app-of-apps pattern: `gitops/bootstrap/root-app.yaml` creates every Application in `gitops/apps/`.

## Consequences

- ✅ Pull-based delivery; rollback is `git revert`; drift is corrected automatically (`selfHeal`).
- ✅ A visual UI that helps explain the system and troubleshoot syncs.
- ⚠️ We operate Argo CD ourselves (upgrades, HA and SSO in production).

## Alternatives

- **Flux via the AKS GitOps extension** — Microsoft-managed controller, Azure Policy integration, no UI. A strong choice when the client prefers managed components.
- **Push deploys from CI (`helm upgrade`)** — simpler, but CI holds powerful cluster credentials and drift is not corrected.
