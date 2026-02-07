export function getSecurityOverlay() {
  return `## SECURITY FOCUS — Additional Instructions

Pay extra attention to:
- SQL injection, NoSQL injection, command injection, XSS, SSRF
- Hardcoded credentials, API keys, tokens, or secrets in code
- Missing authentication or authorization checks
- Insecure cryptographic practices (weak hashing, no salt, ECB mode)
- Path traversal vulnerabilities
- Insecure deserialization
- CORS misconfigurations (overly permissive origins)
- Missing CSRF protection
- Sensitive data in logs, error messages, or URLs
- Dependencies with known CVEs being installed
- Permissions being set too broadly (777, 666, world-readable secrets)
- Eval or dynamic code execution with user input
- JWT tokens without proper validation or with "none" algorithm
- Missing rate limiting on authentication endpoints
- File uploads without type/size validation

Escalate all security findings to at least WARNING. Authentication/authorization bypasses and injection vulnerabilities are CRITICAL.`;
}
