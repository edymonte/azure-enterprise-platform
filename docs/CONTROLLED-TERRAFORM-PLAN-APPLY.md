# Controlled Terraform plan → approval → apply (reference)

This document accompanies `.github/workflows/terraform-controlled-reference.yml`. **No Azure execution was performed to create or verify this PR.** The existing `infra.yml` remains unchanged.

## Why a second workflow?

The existing workflow handles PR plans and manual layer runs through `lab`. This explicit opt-in example demonstrates a **saved plan artifact reviewed before a separate production approval**. It is not a replacement for the existing operational pipeline. The repository uses layered roots and distinct `<layer>.tfstate` blobs per [ADR-0001](decisions/ADR-0001-layered-terraform-state.md).

## Activation checklist (not performed)

- [ ] Confirm the intended production subscription, tenant, storage account, state container and service principal. Do not repurpose a lab identity for production without a security review.
- [ ] Review code and confirm a real GitHub environment `production` with required reviewers, prevent self-review, branch restrictions and no bypass as organizational policy permits. **Just naming an environment in YAML does not enable approvals.**
- [ ] Confirm that both `lab` (plan) and `production` (apply) jobs' actual OIDC `sub` claims match appropriate Entra federated credentials; verify issuer and audience. Existing lab federation errors (`AADSTS700213`) must be resolved separately with explicit authorization.
- [ ] Supply scoped repository/environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `TF_STATE_RG`, `TF_STATE_SA`, `ALERT_EMAIL`, `NAME_SUFFIX`, optionally `OPERATOR_IP_RANGES`. Ensure plan/apply resolve **the same** backend, vars, and identity context.
- [ ] Confirm Service Principal permissions for both ARM and Blob data plane and validate network access to the private backend. Avoid broad subscription Owner.
- [ ] Inspect artifact/log access: saved Terraform plan files can contain secrets, so keep retention short, tightly restrict Actions access, and never commit or expose the plan publicly.
- [ ] Ensure all other workflows, local runs and ADO jobs targeting the same state are serialized or respect native backend locking. This GitHub concurrency group only coordinates within this repository.
- [ ] Test in a disposable non-production environment and audit the result **before** any production activation.

## Execution semantics

1. A maintainer manually starts `workflow_dispatch` for one layer; `execute_apply` defaults to `false`.
2. The `plan` job runs inside `lab`, performs backend init/validation and saves a real `tfplan`. This accesses Azure and is **not** a no-impact validation.
3. Reviewers inspect the plan job evidence. The plan artifact is tied to that workflow run and its checkout commit.
4. Only if `execute_apply=true`, the separate `apply` job waits for the real `production` environment gate. It downloads the exact artifact and applies it without replanning.
5. If the state changed, Terraform should reject the stale saved plan. Generate a **new run and approval**; do not bypass locking.
6. Concurrency uses `tfstate-<layer>` across the complete run. Its group intentionally matches `infra.yml`'s manual job, while Azure Blob's native state lock remains authoritative.

**Important limitation:** a plan may itself be outdated if Azure resources drift without updating the state. A saved plan gate is not a universal drift-detection or change-freeze solution. Protect manual changes and investigate drift.

## Security and review notes

- No automated push/PR triggers, no default apply, no automatic destruction, no `force-unlock` and no `-lock=false`.
- `execute_apply=true` alone is **not** sufficient as a safe control. The repository administrator must explicitly configure required reviewers in `production`. Do not run the workflow until this is verified.
- The apply job has OIDC context `environment:production`; it is not necessarily trusted by existing `lab` federated credentials.
- `queue: max` retains waiting runs instead of silently discarding all but one, but jobs are not guaranteed strict FIFO order. Review state and plans after other applies.
- The plan artifact is a sensitive binary. This workflow does not post full plan contents to PR comments.

## Failure decisions

| Symptom | Stop and inspect |
|---|---|
| OIDC exchange denied | Actual `iss/aud/sub`, target Client ID and matching federated credential |
| `terraform init` Blob 403 | Backend data-plane role and network restrictions |
| `AuthorizationFailed` | Effective identity/scope/action, role and deny assignments |
| Lock held | Other jobs or local operators; never blindly force-unlock |
| `Saved plan is stale` | Discard plan, rerun from new plan and approval |
| `-/+` replacement | Identify exact attribute and impact; stop destructive apply |

Study companion: [OIDC → Terraform troubleshooting guide](https://github.com/edymonte/az400-reforcos/blob/main/relatorios/guia-sprint/EXTRA-oidc-rbac-terraform-recovery.md) (link becomes active after the companion PR is merged).

## Review / verification status

- Source and existing `infra.yml` inspected.
- No GitHub environment settings, secrets, federated credentials or Azure RBAC changed.
- No workflow dispatched; no Terraform or Azure execution performed.
- Before merge, review action versions and GitHub YAML syntax using the repository's configured CI/lint workflow.
