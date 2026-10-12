# Phase 05 — Private data: Key Vault and Azure SQL (4 h)

## 🎯 Goal

Create the secret store and the portal database with **no public exposure** and **no passwords**.

## 🧠 Concepts

A **Private Endpoint (PE)** is a NIC with a **private** IP in your subnet that represents the PaaS service. It comes with a DNS trick:

```text
sql-mfs-portal-xxxxx.database.windows.net
   CNAME → sql-mfs-portal-xxxxx.privatelink.database.windows.net
             ├─ inside the VNet (linked private zone) → 10.60.8.5   ✅
             └─ outside the VNet (public DNS)         → public IP   ❌ (public access disabled)
```

The name is the same for everyone; **who resolves it** decides the path. That is why phase 03 linked the private zones to the spoke.

**Entra-only SQL:** `azuread_authentication_only = true` disables SQL logins. The admin is the **group** `grp-mfs-sql-admins` (phase 02). The application will connect as a *contained user* mapped to its managed identity (phase 07).

## 🛠️ Steps

### 1. Read the code (`infra/terraform/30-data/main.tf`)

| Snippet | Why |
|---|---|
| comment "No secret VALUES are managed here" | `azurerm_key_vault_secret` would store the value **in plain text in state**. Secrets enter the vault another way. |
| `network_acls { default_action = "Deny", ip_rules = ... }` | Key Vault's data plane only accepts your IP and the private endpoint. |
| `data.terraform_remote_state.identity` | The SQL admin comes from the phase 02 output — no copy-pasted IDs. |
| `azurerm_mssql_firewall_rule.operator` with a conditional `for_each` | A resource that only exists while `sql_temporary_public_access = true`. Handy for one-off tasks (phase 07). |
| `storage_account_type = "Local"` | LRS backups (cheap). Production: Geo/Zone. |

### 2. Apply

```powershell
./scripts/azp.ps1 apply 30-data
```

### 3. Write the first secret (outside Terraform)

```powershell
$kv = terraform -chdir=infra/terraform/30-data output -raw key_vault_name
az keyvault secret set --vault-name $kv --name portal-banner --value "Welcome to the MFS portal — v1"
```

This works because your IP is in `ip_rules` and you are *Key Vault Secrets Officer*.

### 4. Look at DNS from both sides

```powershell
$sql = terraform -chdir=infra/terraform/30-data output -raw sql_server_fqdn
Resolve-DnsName $sql          # from your laptop: CNAME chain → privatelink → public IP
```

In phase 06 you repeat this **from inside the cluster** and get `10.60.8.x`.

## ✅ Checkpoint

```powershell
az network private-endpoint list -g rg-mfs-portal-lab --query "[].{name:name, ip:customDnsConfigs[0].ipAddresses[0]}" -o table
az sql server show -g rg-mfs-portal-lab -n <sql-name> --query "{public:publicNetworkAccess, entraOnly:administrators.azureAdOnlyAuthentication}"
```

- [ ] 2 private endpoints with IPs in `10.60.8.0/24`.
- [ ] SQL with `publicNetworkAccess: Disabled` and `entraOnly: true`.
- [ ] Secret `portal-banner` stored.

## 💥 Break it

1. `30-data` reads the allowed IPs from the **output** of `10-foundation`. Override them at the source and propagate:

   ```powershell
   ./scripts/azp.ps1 apply 10-foundation -Var 'operator_ip_ranges=["198.51.100.1/32"]'
   ./scripts/azp.ps1 apply 30-data
   ```

2. Try reading the secret: `az keyvault secret show --vault-name $kv -n portal-banner`.

- **Observation:** `ForbiddenByFirewall` — but you are *Secrets Officer*!
- **Hypothesis:** the block is at the **network** layer, not identity.
- **Evidence:** `az keyvault show -n $kv --query properties.networkAcls`.
- **Lesson:** for any 403, separate the layers **network → identity → authorization**. Notice the remote-state cascade too: changing a layer-10 output required applying layer 30. Restore with `apply 10-foundation` and `apply 30-data` without `-Var`.

## 🎤 Interview

1. Draw how a private endpoint name resolves from inside and outside the VNet.
2. Why not manage the secret value with `azurerm_key_vault_secret`?
3. Benefits of Entra-only SQL? What changes for the application?
4. Service endpoint vs private endpoint?
