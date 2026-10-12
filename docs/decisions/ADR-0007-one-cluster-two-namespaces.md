# ADR-0007 — One AKS cluster, dev and prod as namespaces

**Status:** accepted (lab trade-off)

## Context

The trial subscription has about 4 vCPUs per region and limited credit.

## Decision

One cluster. `portal-dev` and `portal-prod` are namespaces, each with its own federated credential, values file and Argo CD Application.

## Consequences

- ✅ Affordable, and the GitOps promotion flow is identical to a multi-cluster setup.
- ⚠️ No isolation of control plane, upgrades or noisy neighbours between environments.

## Production

Separate clusters (and usually subscriptions) per environment; Argo CD ApplicationSets or Flux to target them; network isolation and separate identities per environment.
