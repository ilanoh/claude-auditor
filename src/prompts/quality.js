export function getQualityOverlay() {
  return `## CODE QUALITY FOCUS — Additional Instructions

Pay extra attention to:
- Functions exceeding 50 lines or doing too many things
- Deep nesting (more than 3-4 levels)
- Copy-pasted code blocks that should be abstracted
- Missing or incorrect type annotations (in TypeScript projects)
- Inconsistent naming conventions within the same file
- Dead code, unused imports, unreachable branches
- Missing null/undefined checks at system boundaries
- Error swallowing (empty catch blocks)
- Magic numbers or strings that should be constants
- Circular dependencies between modules
- Overly complex conditionals that should be simplified
- Missing cleanup (event listeners, timers, file handles)
- Callbacks that should use async/await
- Mutable state where immutability would be safer

Rate duplicated code and overly complex functions as WARNING. Missing error handling at system boundaries is WARNING or CRITICAL depending on impact.`;
}
