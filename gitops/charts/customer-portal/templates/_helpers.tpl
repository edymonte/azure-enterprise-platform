{{- define "portal.labels" -}}
app.kubernetes.io/part-of: customer-portal
app.kubernetes.io/managed-by: {{ .Release.Service }}
mfs.io/environment: {{ .Values.environment }}
{{- end -}}

{{- define "portal.image" -}}
{{- $root := index . 0 -}}{{- $img := index . 1 -}}
{{- if $root.Values.image.registry -}}
{{ $root.Values.image.registry }}/{{ $img.repository }}:{{ $img.tag }}
{{- else -}}
{{ $img.repository }}:{{ $img.tag }}
{{- end -}}
{{- end -}}

{{- define "portal.securityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
