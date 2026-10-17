// Removes secret-looking values from any text before it is stored or sent to
// the browser. Checkers should never print secrets; this is defence in depth.
const PATTERNS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]'],
  [/\b(AccountKey|SharedAccessKey|Password|Pwd|ClientSecret|client_secret|access_token|refresh_token)\s*[=:]\s*("?)[^;"\s,}]+\2/gi, '$1=[redacted]'],
  [/([?&](sig|se|sv|sp|skoid|sktid)=)[^&\s"]+/gi, '$1[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[redacted-github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted-github-token]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted-private-key]'],
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
