# Phase 01 — Bootstrap and remote state (2 h)

## 🎯 Goal

Create what must exist **before** everything else: the storage where Terraform keeps the state of every layer, the public DNS zone `edymonte.com.br`, and the subscription budget.

## 🧠 Concepts

**State** is Terraform's inventory: it maps every `resource` block in your code to a real Azure resource (by ID). Without state, Terraform does not know what it already created.

**Remote state** puts that inventory in a shared blob, so you, GitHub Actions and Azure DevOps all work on the same environment. It also brings **locking**: the blob gets a *lease* during `apply`, and a second concurrent `apply` is blocked.

**The chicken-and-egg problem:** the state storage is itself a Terraform resource — so where does *its* state live? This lab's answer: `00-bootstrap` uses **local state** (a file on your disk). It is small, rarely changes, and is created once.

## 🛠️ Steps

### 1. Read the code before applying

Open `infra/terraform/00-bootstrap/main.tf` and find:

| Block | Notice |
|---|---|
| `azurerm_storage_account.tfstate` | `shared_access_key_enabled = false` → Entra ID access only, no master key. `versioning_enabled = true` → every `apply` creates a state version you can roll back to. |
| `azurerm_role_assignment.state_operator` | You get *Storage Blob Data Contributor*. Being subscription Owner does **not** grant access to blob data (control plane vs data plane). |
| `azurerm_dns_zone.public` | Lives here, not in `50-edge`, because recreating the zone may change its name servers and break the delegation at Registro.br. |
| `azurerm_consumption_budget_subscription.lab` | `lifecycle { ignore_changes = [time_period] }` stops Terraform from "fixing" the start date every month. |

### 2. Apply

```powershell
./scripts/azp.ps1 bootstrap
```

The script prints every command (`init`, `plan`, `apply`). Read the plan: **every** resource should be `+ create`.

At the end it generates:

- `.runtime/backend.hcl` → where state lives (used by every other layer's `init`);
- `.runtime/common.tfvars.json` → shared variables;
- the **4 name servers** of the `edymonte.com.br` zone in Azure DNS.

### 3. Delegate the domain at Registro.br

Today `edymonte.com.br` DNS is hosted by Registro.br (`b.sec.dns.br` and `c.sec.dns.br`) with no records in use. We hand the whole zone to Azure DNS:

1. Go to <https://registro.br> → **Meus domínios** → `edymonte.com.br`.
2. Under **DNS** → **Alterar servidores DNS**, enter the 4 servers printed by the script (e.g. `ns1-03.azure-dns.com`, `ns2-03.azure-dns.net`, `ns3-03.azure-dns.org`, `ns4-03.azure-dns.info`).
3. If DNSSEC is enabled at Registro.br, disable it first (otherwise resolution fails).
4. Save. Propagation for `.br` usually takes minutes to a few hours.

Check:

```powershell
Resolve-DnsName edymonte.com.br -Type NS -Server 8.8.8.8
```

Once the `azure-dns` servers show up, the delegation is live. From now on, **every DNS record of the domain is created by Terraform**.

## ✅ Checkpoint

```powershell
terraform -chdir=infra/terraform/00-bootstrap output
az storage blob list --account-name <state_storage_account_name> --container-name tfstate --auth-mode login -o table
```

- [ ] Storage created; listing works with `--auth-mode login` (no key).
- [ ] Budget visible under *Cost Management → Budgets*.
- [ ] `Resolve-DnsName` returns the Azure name servers.

## 💥 Break it

Try listing the container with an access key:

```powershell
az storage blob list --account-name <sa> --container-name tfstate --auth-mode key
```

- **Observation:** authorization error.
- **Hypothesis:** shared keys are disabled.
- **Evidence:** `az storage account show -n <sa> --query allowSharedKeyAccess` → `false`.
- **Conclusion:** state is only reachable by an Entra identity with the right data role. Why is that good? A leaked key would give full, anonymous access to the state, which contains IDs, IPs and sometimes sensitive values.

## 🏋️ Challenge (optional)

Migrate the bootstrap's own state into the remote blob, under the key `00-bootstrap.tfstate`.

<details><summary>Answer</summary>

1. Create `infra/terraform/00-bootstrap/backend.tf` with `terraform { backend "azurerm" {} }`.
2. Run:

```powershell
terraform -chdir=infra/terraform/00-bootstrap init -migrate-state `
  -backend-config=../../../.runtime/backend.hcl -backend-config=key=00-bootstrap.tfstate
```

3. Answer `yes` to copy the state. Caveat: to destroy the bootstrap at the end of the lab you must migrate back to local first — the storage account cannot delete itself while it holds its own state.

</details>

## 🎤 Interview

1. What happens if two people run `terraform apply` at the same time with the azurerm backend?
2. Why should state have versioning and soft delete?
3. What is the difference between subscription Owner and *Storage Blob Data Contributor*?
4. Why is the DNS zone not in the same layer as Front Door?
