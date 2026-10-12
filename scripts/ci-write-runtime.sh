#!/usr/bin/env bash
# CI equivalent of 'azp.ps1 bootstrap' outputs: writes .runtime/backend.hcl and
# .runtime/common.tfvars.json from pipeline variables (GitHub vars / ADO variable group).
set -euo pipefail

: "${ARM_SUBSCRIPTION_ID:?}" "${TF_STATE_RG:?}" "${TF_STATE_SA:?}" "${ALERT_EMAIL:?}" "${NAME_SUFFIX:?}"
OPERATOR_IP_RANGES="${OPERATOR_IP_RANGES:-[]}"   # JSON array, e.g. ["203.0.113.10/32"]

mkdir -p .runtime
cat > .runtime/backend.hcl <<EOF
subscription_id      = "${ARM_SUBSCRIPTION_ID}"
resource_group_name  = "${TF_STATE_RG}"
storage_account_name = "${TF_STATE_SA}"
container_name       = "tfstate"
use_azuread_auth     = true
use_oidc             = true
EOF

cat > .runtime/common.tfvars.json <<EOF
{
  "subscription_id": "${ARM_SUBSCRIPTION_ID}",
  "alert_email": "${ALERT_EMAIL}",
  "operator_ip_ranges": ${OPERATOR_IP_RANGES},
  "state_resource_group_name": "${TF_STATE_RG}",
  "state_storage_account_name": "${TF_STATE_SA}",
  "name_suffix": "${NAME_SUFFIX}"
}
EOF
echo "runtime files written"
