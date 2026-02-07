export function getPerformanceOverlay() {
  return `## PERFORMANCE FOCUS — Additional Instructions

Pay extra attention to:
- N+1 query patterns (looping database calls instead of batch)
- Missing database indexes for queried fields
- Synchronous operations that should be async/parallel
- Large datasets loaded entirely into memory
- Missing pagination on list endpoints
- Unbounded queries without LIMIT
- Re-rendering entire component trees unnecessarily (React)
- Expensive computations inside render loops
- Missing caching for expensive or repeated operations
- Large bundle sizes from importing entire libraries
- Blocking the event loop with synchronous I/O
- Missing connection pooling for database/HTTP clients
- Regex patterns vulnerable to ReDoS
- String concatenation in loops instead of array.join()
- Unoptimized images or assets being served

Rate N+1 queries and missing pagination as WARNING. Blocking the event loop and ReDoS vulnerabilities are CRITICAL.`;
}
