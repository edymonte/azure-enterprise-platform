# Azure DevOps pipelines — refresher

A compact memory aid for someone who knows GitHub Actions (GH-200) and needs Azure DevOps back in their head — for real work and for interviews.

## 1. The mental model

```text
Organization ── Project ──┬── Repos (or external: GitHub)
                          ├── Pipelines ── YAML ── stages ── jobs ── steps (tasks / scripts)
                          ├── Library ──── variable groups (+ Key Vault link), secure files
                          ├── Environments ── approvals & checks, deployment history
                          └── Project settings ── service connections, agent pools, permissions
```

| GitHub Actions | Azure DevOps |
|---|---|
| workflow | pipeline |
| job | job (inside a **stage**) |
| step / action | step / **task** (`AzureCLI@2`, `Docker@2`, …) |
| runner | agent (Microsoft-hosted or self-hosted, in an **agent pool**) |
| `environment:` with reviewers | `deployment` job targeting an **Environment** with **Approvals and checks** |
| secrets / variables | variables, **variable groups**, Key Vault–linked groups, secure files |
| reusable workflow / composite action | **templates** (steps/jobs/stages/variables) and **`extends`** |
| `azure/login` with OIDC | **service connection** with workload identity federation |
| `on:` | `trigger:`, `pr:`, `schedules:`, `resources: pipelines/repositories` |

## 2. Creating a pipeline — the checklist (in order)

1. **Organization & project** — `dev.azure.com/<org>/<project>`.
2. **Agents** — Microsoft-hosted needs *parallel jobs* (new orgs may need the free grant request) or register a **self-hosted agent** (*Project settings → Agent pools → New agent*: download, `config.cmd`, run as service).
3. **Source connection** — Azure Repos (native) or GitHub (*service connection type GitHub*, OAuth/GitHub App).
4. **Azure service connection** — *Azure Resource Manager → Workload identity federation*:
   - *automatic*: ADO creates the app registration + federated credential + role for you (fast, less control);
   - *manual*: you create the identity (e.g. Terraform) and paste issuer/subject → recommended for enterprises.
   - Grant **RBAC** at the right scope (subscription / RG). Authentication ≠ authorization.
5. **Variable groups** — *Pipelines → Library*; link to Key Vault for secrets; set *pipeline permissions*.
6. **Environments** — *Pipelines → Environments*; add **Approvals**, **Branch control**, **Business hours**, **Required template**, **Invoke REST API / Azure Function** checks as needed.
7. **YAML file** in the repo → *Pipelines → New pipeline → (source) → Existing YAML file*.
8. **First run** — authorize resources (service connection, variable groups, environments, agent pool) when prompted.
9. **Branch policies** (Azure Repos) — *Repos → Branches → main → Branch policies*: minimum reviewers, linked work items, **Build validation** (the PR pipeline must pass). For GitHub repos use GitHub branch protection + the ADO status check.

## 3. YAML skeleton you should be able to write from memory

```yaml
trigger:
  branches: { include: [main] }
  paths: { include: [infra/*] }

pr:
  branches: { include: [main] }

parameters:
  - name: environment
    type: string
    default: dev
    values: [dev, prod]

variables:
  - group: mfs-common                 # variable group
  - name: serviceConnection
    value: sc-mfs-${{ parameters.environment }}

pool:
  vmImage: ubuntu-latest

stages:
  - stage: Build
    jobs:
      - job: build
        steps:
          - checkout: self
          - script: npm ci && npm test
            displayName: test
          - task: PublishPipelineArtifact@1
            inputs:
              targetPath: $(Build.ArtifactStagingDirectory)
              artifact: drop

  - stage: Deploy
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: deploy
        environment: mfs-${{ parameters.environment }}     # approvals live here
        strategy:
          runOnce:
            deploy:
              steps:
                - download: current
                  artifact: drop
                - task: AzureCLI@2
                  inputs:
                    azureSubscription: ${{ variables.serviceConnection }}
                    scriptType: bash
                    scriptLocation: inlineScript
                    inlineScript: az group list -o table
```

## 4. Things interviewers like to probe

| Topic | Key point |
|---|---|
| `${{ }}` vs `$( )` vs `$[ ]` | compile-time template expression / runtime macro / runtime expression. Service connections and template insertion need **compile time**. |
| Deployment strategies | `runOnce`, `rolling` (VMs), `canary` — on deployment jobs. |
| Templates | `template: steps.yml` with `parameters:`; **`extends`** + *Required template* check = enforced governance. |
| Artifacts | Pipeline artifacts (fast, per run) vs Azure Artifacts feeds (packages). |
| Multi-repo | `resources: repositories:` + `checkout: <alias>`. |
| Pipeline chaining | `resources: pipelines:` with `trigger:`. |
| Secrets | Secret variables are masked and **not** passed to forks or exposed as env vars unless mapped explicitly (`env:`). |
| Caching | `Cache@2` task with a key (e.g. `package-lock.json`). |
| Classic → YAML migration | Releases → multi-stage YAML; release gates → environment checks; task groups → templates. |
| Terraform auth with WIF | `AzureCLI@2` + `addSpnToEnvironment: true` → `$idToken`, `$servicePrincipalId`, `$tenantId` → `ARM_OIDC_TOKEN`, `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_USE_OIDC=true`. |

## 5. Troubleshooting map

| Symptom | Likely cause | Check |
|---|---|---|
| Run stuck in queue: "No hosted parallelism" | Free grant not approved | Request grant / self-hosted agent |
| "Resource not authorized" on first run | Pipeline permission on service connection / variable group / environment | Click *Permit* or set pipeline permissions |
| `AADSTS700213 / 70021` | Federated credential issuer/subject mismatch | Compare with service connection details |
| `AuthorizationFailed` | RBAC missing at that scope | `az role assignment list --assignee <app-id>` |
| Variable empty in script | Secret variables are not auto-mapped to env | Map with `env: MY_SECRET: $(mySecret)` |
| Template parameter not applied | Used `$( )` where compile time was needed | Use `${{ }}` |

## 6. Where this repository uses each concept

- `pipelines/azure-devops/infra.yml` — parameters, variable group, stages, deployment job on environment, compile-time service connection.
- `pipelines/azure-devops/templates/terraform-layer.yml` — step template, WIF → Terraform OIDC.
- `pipelines/azure-devops/app.yml` — path trigger, Docker build, Trivy scan, ACR push via WIF, GitOps PR on GitHub with a Key Vault–backed secret.
