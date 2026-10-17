// Kubernetes arithmetic shared by checkers (kept pure so it can be unit-tested).

export function selects(selector, labels) {
  const match = selector?.matchLabels;
  if (!match || Object.keys(match).length === 0) return false;
  return Object.entries(match).every(([k, v]) => labels?.[k] === v);
}

function scaled(value, total) {
  if (typeof value === 'number') return value;
  const m = /^(\d+)%$/.exec(String(value));
  if (!m) return NaN;
  // The disruption controller rounds percentages up for both fields.
  return Math.ceil((Number(m[1]) / 100) * total);
}

// Voluntary disruptions a PodDisruptionBudget allows when the workload runs
// at `replicas` healthy pods (what `kubectl get pdb` shows as ALLOWED DISRUPTIONS).
export function allowedDisruptions(spec, replicas) {
  if (spec.maxUnavailable !== undefined && spec.maxUnavailable !== null) {
    return Math.max(0, Math.min(replicas, scaled(spec.maxUnavailable, replicas)));
  }
  if (spec.minAvailable !== undefined && spec.minAvailable !== null) {
    return Math.max(0, replicas - scaled(spec.minAvailable, replicas));
  }
  return NaN;
}
