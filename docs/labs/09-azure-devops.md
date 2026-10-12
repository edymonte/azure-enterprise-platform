# Phase 09 — CI/CD with Azure DevOps (5 h)

## 🎯 Goal

Rebuild the phase 08 pipelines in Azure DevOps and **compare** both tools. First read the refresher: **[docs/azure-devops-refresher.md](../azure-devops-refresher.md)**.

The YAML is already in `pipelines/azure-devops/`. This phase is about **building the Azure DevOps setup around it** — exactly the part people forget.

## 🛠️ Steps

### 1. Organization and project

1. <https://dev.azure.com> → create an organization (e.g. `edymonte-lab`) and the project `mfs-platform`.
2. **Parallelism:** new organizations may have no free *Microsoft-hosted parallel jobs*. If the first run stays queued with that message, request the free grant through Microsoft's form (takes a few business days) or register a *self-hosted agent* on your machine (*Project settings → Agent pools*). **Do this on day one of the phase.**

### 2. GitHub connection

*Project settings → Service connections → New → GitHub* (OAuth or GitHub App). The code stays on GitHub; Azure DevOps only reads and runs it.

### 3. Azure service connection with Workload Identity Federation (manual mode)

Manual mode keeps the identity **in your Terraform** instead of letting Azure DevOps create an app for you.

1. *Service connections → New → Azure Resource Manager → **Workload Identity federation (manual)***.
2. Name: `sc-mfs-lab-wif`. Continue: Azure DevOps shows the **Issuer** and **Subject identifier**. Copy both.
3. Create `infra/terraform/05-identity/terraform.tfvars` (git-ignored):

   ```hcl
   ado_federated_issuer  = "https://login.microsoftonline.com/<tenant-id>/v2.0"
   ado_federated_subject = "/eid1/c/pub/t/.../sc/.../..."
   ```

4. `./scripts/azp.ps1 apply 05-identity` → creates `app-mfs-azure-devops`, its federated credential, the 4 roles, state access and SQL admin group membership.
5. Back in Azure DevOps, fill in: Subscription ID, Subscription name, **Service principal (client) ID** = `terraform -chdir=infra/terraform/05-identity output -raw ado_client_id`, Tenant ID. **Verify and save**.

### 4. Variable groups (*Pipelines → Library*)

| Group | Variables | Note |
|---|---|---|
| `mfs-lab-common` | `TF_STATE_RG`, `TF_STATE_SA`, `ALERT_EMAIL`, `OPERATOR_IP_RANGES`, `NAME_SUFFIX` | plain values |
| `mfs-lab-app` | `ACR_NAME`, `GITOPS_GITHUB_TOKEN` | **Link secrets from an Azure key vault** for the token |

For the token: create a GitHub *fine-grained PAT* (Contents: write, Pull requests: write, this repo only) and store it in Key Vault (`az keyvault secret set --name GITOPS-GITHUB-TOKEN ...`). The linked variable group reads it from the vault. Key Vault has a firewall: `bypass = "AzureServices"` is already set — if you still get an error, diagnosing it is a good exercise.

### 5. Environment with approval

*Pipelines → Environments → New* → `mfs-lab` → *Approvals and checks* → **Approvals** (you). Optional: **Branch control** allowing only `refs/heads/main`.

### 6. Create the pipelines from YAML

*Pipelines → New → GitHub → repository → Existing Azure Pipelines YAML file* → `/pipelines/azure-devops/infra.yml`. Repeat for `app.yml`. On the first run, authorize the service connection, variable groups and environment (*Permit*).

## ✅ Checkpoint

- [ ] `infra` with `layer=10-foundation`, `action=plan`: Validate and Plan stages pass.
- [ ] With `action=apply`, the Apply stage **waits** for approval on the environment.
- [ ] `app` pushes images to ACR and opens the deploy PR on GitHub.

## 💥 Break it

Change one character of `ado_federated_subject`, apply `05-identity`, run the pipeline.

- **Observation:** `AADSTS700213 ... No matching federated identity record found`.
- **Same lesson as phase 02:** authentication (federation) vs authorization (RBAC). The tool changes; the diagnosis does not.

## 🎤 Interview — side by side

| Question | GitHub Actions | Azure DevOps |
|---|---|---|
| Where is the approval gate? | Environment (reviewers) | Environment (Approvals and checks) |
| How does the pipeline authenticate to Azure? | OIDC via `azure/login` / `ARM_USE_OIDC` | WIF service connection + `AzureCLI@2 addSpnToEnvironment` |
| Reuse | Reusable workflows / composite actions | Templates (`steps`, `jobs`, `stages`) + `extends` |
| Secrets | Secrets / Environments | Variable groups (+ Key Vault link) / secure files |
| Parallelism | Per plan/account | *Parallel jobs* per organization |
| Deployment traceability | Environment deployments | Environment → deployment history per resource |
