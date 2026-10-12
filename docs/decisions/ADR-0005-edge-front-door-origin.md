# ADR-0005 — Front Door with a public origin locked by NSG

**Status:** accepted (lab trade-off)

## Context

Front Door must reach the AKS ingress. Options: a public origin, or Front Door Premium Private Link to an internal load balancer through a Private Link Service.

## Decision

A static public IP on a dedicated NGINX ingress controller. The AKS subnet NSG allows only the `AzureFrontDoor.Backend` service tag (plus the operator IP). TLS terminates at Front Door; Front Door → origin uses HTTP. The WAF starts in Detection, then moves to Prevention.

## Consequences

- ✅ Simple, cheap, easy to observe and explain.
- ⚠️ The service tag covers **all** Front Door customers, so the origin should also validate the `X-Azure-FDID` header (phase 10 challenge).
- ⚠️ The hop between Front Door and the origin is not encrypted.

## Alternatives

- **Front Door Premium Private Link** to an internal load balancer — no public origin at all (production recommendation).
- **Application Gateway (for Containers) + WAF** — regional, in-VNet layer 7; often combined with Front Door.
- **Traffic Manager** — DNS only; kept as a separate DR lab to show the difference (no proxy, failover bounded by TTL).
