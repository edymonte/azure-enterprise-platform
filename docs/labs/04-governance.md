# Phase 04 — Governance: Azure Policy and Defender (4 h)

## 🎯 Goal

Put **guardrails** on the whole subscription — allowed regions, mandatory tags, SQL without public access, a pod security baseline for AKS — and enable Defender for Cloud. All as code.

## 🧠 Concepts

| Concept | Summary |
|---|---|
| **Policy definition** | A rule (`if` → `then: effect`). E.g. "if it is a SQL server and `publicNetworkAccess` ≠ Disabled → *effect*". |
| **Initiative** (policy set) | Several definitions grouped and assigned together, with one compliance score. |
| **Assignment** | Applies a definition/initiative at a scope (management group, subscription, RG) with parameters. |
| **Effects** | `Audit` (record), `Deny` (block), `Modify`/`DeployIfNotExists` (remediate), `Disabled`. |
| **Defender for Cloud** | Workload protection (threat detection, vulnerabilities). Policy prevents bad configuration; Defender detects attacks. They complement each other. |

**Real-world rollout strategy:** start in `Audit`, measure the impact, and only then switch to `Deny`. Turning on `Deny` on day one breaks other teams' pipelines on Monday morning.

## 🛠️ Steps

### 1. Policy as code

Open `infra/policies/sql-deny-public-network.rule.json`. It is plain JSON, reviewed in PRs like any code. Terraform loads it with `file()`:

```hcl
policy_rule = file("${local.policy_dir}/sql-deny-public-network.rule.json")
```

Now read `require-rg-tags.rule.json`. It uses `count` over a **parameter** (the tag list) and excludes resource groups Azure creates for you (`MC_*`, `NetworkWatcherRG`). Without that exclusion, AKS could never create its node resource group under `Deny`.

### 2. Apply in Audit mode

```powershell
./scripts/azp.ps1 apply 20-governance
```

### 3. Create a non-compliant resource on purpose

```powershell
az group create -n rg-test-no-tags -l eastus2
az policy state trigger-scan --no-wait     # evaluation is asynchronous
```

A few minutes later:

```powershell
az policy state summarize --query "policyAssignments[].{assignment:policyAssignmentId, nonCompliant:results.nonCompliantResources}" -o table
az policy state list --filter "complianceState eq 'NonCompliant'" --query "[].{resource:resourceId, policy:policyDefinitionReferenceId}" -o table
```

### 4. Switch to Deny (as you would after the Audit period)

```powershell
./scripts/azp.ps1 apply 20-governance -Var 'guardrail_effect=Deny'
az group create -n rg-test-blocked -l eastus2
```

Expected: `RequestDisallowedByPolicy`, showing the `non_compliance_message` you wrote in Terraform. Clean up and go back to Audit (later phases create temporary resources that would be blocked):

```powershell
az group delete -n rg-test-no-tags --yes --no-wait
./scripts/azp.ps1 apply 20-governance
```

### 5. Defender

```powershell
az security pricing list --query "value[?pricingTier=='Standard'].name" -o tsv
```

`Containers`, `KeyVaults` and `SqlServers` show as `Standard` (30-day trial). In phase 06 the Defender sensor appears as a DaemonSet in AKS.

## ✅ Checkpoint

- [ ] Initiative `[MFS] Platform guardrails` assigned to the subscription.
- [ ] An untagged RG shows as non-compliant in Audit and is blocked in Deny.
- [ ] Defender plans set to `Standard`.

## 💥 Break it

With `guardrail_effect=Deny`, try creating something in `westeurope`:

```powershell
az group create -n rg-mfs-test-eu -l westeurope --tags Owner=x Environment=x CostCenter=x
```

**Observation:** blocked even with the tags. **Hypothesis:** another policy in the initiative. **Evidence:** the message mentions `allowedLocations`. **Question:** why is `brazilsouth` on the list? *(Traffic Manager DR lab, phase 10.)*

## 🏋️ Challenge

Add a **third custom policy** to the initiative: Key Vaults must have soft-delete retention ≥ 7 days (alias `Microsoft.KeyVault/vaults/softDeleteRetentionInDays`).

<details><summary>Answer</summary>

`infra/policies/kv-soft-delete-retention.rule.json`:

```json
{
  "if": {
    "allOf": [
      { "field": "type", "equals": "Microsoft.KeyVault/vaults" },
      { "field": "Microsoft.KeyVault/vaults/softDeleteRetentionInDays", "less": 7 }
    ]
  },
  "then": { "effect": "[parameters('effect')]" }
}
```

In `20-governance/main.tf`: a new `azurerm_policy_definition` (copy the SQL one, change name and file) and a new `policy_definition_reference` block in the initiative passing `effect = "[parameters('guardrailEffect')]"`. Run `plan`: the initiative is **updated in place** and the assignment does not change.

</details>

## 🎤 Interview

1. Azure Policy vs Azure RBAC?
2. Why start in Audit? How would you measure the impact before switching to Deny?
3. What is an *exemption* and when do you use one?
4. Policy prevents bad configuration — what does Defender do that Policy cannot?
5. How is the AKS pod baseline enforced inside the cluster? *(Azure Policy add-on → Gatekeeper/OPA admission control.)*
