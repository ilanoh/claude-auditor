export function getComplianceOverlay() {
  return `## SPEC COMPLIANCE FOCUS — Additional Instructions

Pay extra attention to:
- Deviations from the spec or requirements discussed earlier in the session
- API endpoints that don't match the agreed-upon schema
- Data models missing required fields from the spec
- Business logic that contradicts stated requirements
- UI elements that don't match the described design
- Missing validation rules that were specified
- Workflows that skip required steps
- Edge cases explicitly mentioned in the spec that aren't handled
- Feature behavior that contradicts the user's stated expectations
- Return types or response formats that differ from spec

If you notice the worker building something fundamentally different from what was discussed (e.g., REST instead of GraphQL, SQL instead of NoSQL), use [INTERRUPT] immediately.

Rate spec deviations as WARNING. Fundamental architectural mismatches with the spec are CRITICAL + [INTERRUPT].`;
}
