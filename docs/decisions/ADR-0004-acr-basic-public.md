# ADR-0004 — ACR Basic with a public endpoint

**Status:** accepted (lab trade-off)

## Context

Private endpoints for Azure Container Registry require the **Premium** SKU, which costs much more per day than Basic.

## Decision

Use ACR Basic with the admin user disabled. Pulls are authorized through the AKS kubelet identity (`AcrPull`) and pushes through the pipeline identity.

## Consequences

- ✅ Low cost; identity-based access only.
- ⚠️ The registry endpoint is reachable from the internet (still authenticated).

## Production

Premium SKU + private endpoint + public network access disabled, private DNS zone `privatelink.azurecr.io`, self-hosted build agents inside the VNet, image signing (Notation) and Defender vulnerability scanning.
