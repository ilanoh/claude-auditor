# claude-auditor

Real-time AI session auditor for Claude Code. Wraps any `claude` session inside a PTY proxy, captures terminal output, and feeds it to a second Claude instance for live critical analysis.

You see everything normally — the auditor works silently in the background and produces findings.

## How It Works

```
User ↔ PTY Proxy (node-pty) ↔ claude (worker)
              │
              │ tee output
              ▼
        ANSI Stripper → Intelligent Chunker → Auditor Brain → Findings
                                                    │
                                              Supervisor ──→ Inject / Interrupt / Recalibrate
```

1. **PTY Proxy** spawns `claude` in a pseudo-terminal, forwarding all I/O transparently
2. **Chunker** strips ANSI codes and splits output into intelligent chunks (by tool boundaries, time, or size)
3. **Auditor Brain** sends each chunk to a second `claude -p` instance with a critic persona
4. **Supervisor** acts on findings: logs them, injects corrections, or interrupts the worker for recalibration

## Install

```bash
npm install -g claude-auditor
```

Or run directly:

```bash
npx claude-auditor
```

## Usage

```bash
# Basic: supervised mode with default settings
claude-auditor

# Security-focused audit
claude-auditor --focus security

# Multiple focus areas
claude-auditor --focus security,quality,performance

# Active mode with live findings log
claude-auditor --mode active --focus security

# Fully autonomous — auditor corrects the worker without asking
claude-auditor --autonomy full

# Silent observer — just log findings, no intervention
claude-auditor --autonomy observe

# Pass arguments to claude
claude-auditor -- --resume abc123
claude-auditor -- -p "Build a REST API"

# Custom budget and model
claude-auditor --auditor-model opus --max-budget 5.00
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--mode <passive\|active>` | `passive` | `passive`: report at end. `active`: live findings log |
| `--focus <areas>` | — | Comma-separated: `security`, `quality`, `compliance`, `performance` |
| `--auditor-model <model>` | `sonnet` | Model for the auditor brain |
| `--output <path>` | `./audit-report.md` | Report output path |
| `--log <path>` | `/tmp/claude-audit-<pid>.log` | Live findings log (active mode) |
| `--max-budget <usd>` | `1.00` | Max auditor spend before stopping analysis |
| `--chunk-interval <seconds>` | `30` | Time-based chunk flush interval |
| `--autonomy <level>` | `supervised` | `full`, `supervised`, or `observe` |
| `--verbose` | `false` | Show auditor activity in stderr |
| `--no-report` | `false` | Skip final report generation |

Everything after `--` is passed directly to `claude`.

## Autonomy Levels

### `observe` — Silent watcher
Findings are logged but the auditor never interacts with the worker. Use this when you want a post-session audit report without any interference.

### `supervised` (default) — Human in the loop
When the auditor wants to inject a correction or interrupt the worker, it asks you first. In active mode, an auditor console shows real-time findings and approval prompts.

### `full` — Autonomous supervisor
The auditor injects corrections and interrupts the worker without asking. Use with caution — the auditor may send messages to your claude session autonomously.

## Supervisor State Machine

The supervisor manages the relationship between auditor and worker:

```
MONITORING → (finding) → ALERT → (warning) → INJECT → MONITORING
                                → (critical) → INTERRUPT → RECALIBRATE → MONITORING
```

- **MONITORING**: Normal state. Chunks flow to auditor, findings are logged.
- **ALERT**: Finding detected. Route based on severity.
- **INJECT**: Send a single corrective message to the worker.
- **INTERRUPT**: Pause the worker for a critical issue.
- **RECALIBRATE**: Multi-turn dialogue between auditor and worker until the worker is back on track.

## Focus Areas

### Security
SQL injection, XSS, hardcoded secrets, auth bypasses, CORS misconfig, insecure crypto, SSRF, path traversal, and more.

### Quality
Function complexity, deep nesting, copy-paste code, missing error handling, dead code, naming conventions, circular dependencies.

### Compliance
Spec deviations, API schema mismatches, missing business logic, wrong architecture patterns, skipped workflow steps.

### Performance
N+1 queries, missing pagination, blocking I/O, missing caching, large bundle imports, ReDoS vulnerabilities.

## Audit Report

At session end, a markdown report is generated:

```markdown
# Audit Report
**Duration**: 15 minutes
**Auditor model**: sonnet | **Auditor cost**: $0.12

## Summary
- 2 critical findings
- 5 warnings
- 3 suggestions

## Findings
### CRITICAL
1. [12:03:45] SQL injection in user search endpoint
2. [12:07:12] Hardcoded database password in config

### WARNING
...

## Session Statistics
- Total chunks analyzed: 24
- Tool calls observed: Read: 12, Edit: 8, Bash: 4
```

## How the Chunker Works

Output is split into chunks using a hybrid strategy:

1. **Boundary detection**: Regex patterns for tool call markers (Read, Edit, Bash, etc.)
2. **Time-based**: Every N seconds if buffer has content
3. **Size cap**: When buffer exceeds 200 lines
4. **Debounce**: After output stops for 2 seconds

This ensures the auditor sees complete tool interactions rather than arbitrary text fragments.

## Requirements

- Node.js >= 18
- `claude` CLI installed and available in PATH

## License

MIT
