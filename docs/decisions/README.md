# Architecture decision records

Short records of **why** the platform looks the way it does. Format: Context → Decision → Consequences → Alternatives. In interviews, each ADR is a ready-made answer to "why did you choose X?".

| ADR | Decision |
|---|---|
| [0001](ADR-0001-layered-terraform-state.md) | Layered Terraform roots with one state per layer |
| [0002](ADR-0002-argo-cd-for-gitops.md) | Argo CD (not Flux) for GitOps |
| [0003](ADR-0003-ci-opens-prs-never-deploys.md) | CI opens PRs; it never deploys to the cluster |
| [0004](ADR-0004-acr-basic-public.md) | ACR Basic with a public endpoint (lab cost trade-off) |
| [0005](ADR-0005-edge-front-door-origin.md) | Front Door with a public origin locked by NSG (not Private Link) |
| [0006](ADR-0006-dual-observability.md) | Two observability stacks: Azure-native + Datadog |
| [0007](ADR-0007-one-cluster-two-namespaces.md) | One AKS cluster, dev and prod as namespaces |
