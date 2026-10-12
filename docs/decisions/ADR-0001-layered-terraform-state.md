# ADR-0001 — Layered Terraform roots with one state per layer

**Status:** accepted

## Context

The platform spans identity, network, governance, data, compute, edge and observability. These change at different rates, have different owners in a real company, and have very different costs (Front Door Premium vs a VNet).

## Decision

Split Terraform into numbered root modules (`00`–`70`), each with its own state blob in one storage account (key = layer name). Layers consume upstream outputs through `terraform_remote_state`. A lifecycle script applies them in order and destroys them in reverse. A stable name suffix lives in `00-bootstrap`, so globally unique names survive the daily rebuild.

## Consequences

- ✅ Small blast radius and fast plans; expensive layers can be destroyed independently.
- ✅ Clear dependency order and an explicit output contract between layers.
- ⚠️ Changing an upstream output requires re-applying downstream layers (cascade).
- ⚠️ `terraform_remote_state` needs read access to the upstream state, which exposes all of its outputs.

## Alternatives

- **Single root module** — simplest, but slow and risky at this size.
- **Terragrunt** — DRY backends and dependencies; one more tool to learn and operate.
- **Data sources instead of remote state** — looser coupling; requires predictable names.
- **Production note:** the hub would also host Azure Firewall and gateways, and a landing zone (ALZ / Azure Verified Modules) would own management groups and policies.
