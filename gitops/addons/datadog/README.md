# Datadog add-on (activated in phase 12)

These Argo CD Applications are **not** watched yet. To turn Datadog on, follow
`docs/labs/12-datadog.md`: create the `datadog-secret`, set your account site in
`gitops/platform/datadog/datadog-agent.yaml`, then open a PR that moves these files:

    git mv gitops/addons/datadog/datadog-operator.yaml gitops/apps/
    git mv gitops/addons/datadog/datadog-agent.yaml   gitops/apps/

Turning it off is the reverse PR (Argo CD prunes everything).
