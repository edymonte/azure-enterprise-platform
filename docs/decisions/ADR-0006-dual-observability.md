# ADR-0006 — Two observability stacks

**Status:** accepted

## Context

Clients commonly run Azure Monitor next to a third-party APM (Datadog, Dynatrace). Consultants are asked to compare them.

## Decision

- **Azure-native:** Container Insights (logs → Log Analytics), Managed Prometheus (metrics), Managed Grafana (dashboards), PromQL alert rules → Action Group.
- **Datadog:** Operator + Agent through GitOps, APM with `dd-trace`, monitors / SLO / dashboard through Terraform.

## Consequences

- ✅ A real comparison of setup effort, signal quality and cost.
- ⚠️ Duplicate telemetry cost; in production, pick one primary tool per signal.

## Guidance for clients

Azure-native when the estate is Azure-only and budget matters. Datadog when the estate is multi-cloud, when strong APM and correlation matter, or when one tool must serve many teams.
