import { createInterface } from 'readline';

const SEVERITY_COLORS = {
  CRITICAL: '\x1b[31m',  // Red
  WARNING: '\x1b[33m',   // Yellow
  INFO: '\x1b[36m',      // Cyan
  SUGGESTION: '\x1b[32m', // Green
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

export function createConsole(supervisor, display) {
  // Write to stderr so we don't interfere with the PTY stdout
  const write = (msg) => process.stderr.write(msg);

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: false,
  });

  let isPrompting = false;

  function timestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  function printLine(msg) {
    write(`${DIM}[${timestamp()}]${RESET} ${msg}\n`);
  }

  function printFinding(finding) {
    const color = SEVERITY_COLORS[finding.severity] || '';
    printLine(`${color}[${finding.severity}]${RESET} ${finding.description}`);
  }

  function printState(state) {
    printLine(`${BOLD}[${state}]${RESET}`);
  }

  // Listen to supervisor events
  supervisor.on('finding', (finding) => {
    printFinding(finding);
  });

  supervisor.on('stateChange', ({ from, to }) => {
    if (to !== from) {
      printState(to);
    }
  });

  supervisor.on('inject', ({ message, autoApproved }) => {
    const tag = autoApproved ? 'AUTO-INJECTED' : 'INJECTED';
    printLine(`\x1b[35m[${tag}]\x1b[0m ${message.slice(0, 120)}`);
  });

  supervisor.on('interrupt', ({ reason }) => {
    printLine(`\x1b[31m[INTERRUPTED]\x1b[0m ${reason}`);
  });

  supervisor.on('recalibrate', ({ turn, message }) => {
    printLine(`\x1b[33m[RECALIBRATING T${turn}]\x1b[0m ${message.slice(0, 120)}`);
  });

  supervisor.on('resolved', () => {
    printLine(`\x1b[32m[RESOLVED]\x1b[0m Worker back on track`);
  });

  // Handle approval requests
  supervisor.on('approvalNeeded', (req) => {
    if (isPrompting) return;
    isPrompting = true;

    const typeLabel = req.type === 'interrupt'
      ? `\x1b[31mINTERRUPT\x1b[0m`
      : `\x1b[33mINJECT\x1b[0m`;

    const content = req.reason || req.message;

    write('\n');
    printLine(`${typeLabel} suggested:`);
    write(`  "${content}"\n`);
    write(`  ${BOLD}[S]${RESET}end / ${BOLD}[E]${RESET}dit / ${BOLD}[I]${RESET}gnore ? > `);

    const onLine = (line) => {
      const input = line.trim().toLowerCase();
      rl.removeListener('line', onLine);
      isPrompting = false;

      if (input === 's' || input === 'send') {
        req.approve();
      } else if (input === 'i' || input === 'ignore') {
        req.reject();
        printLine(`${DIM}[IGNORED]${RESET} Action rejected`);
      } else if (input === 'e' || input === 'edit') {
        write('  New message: ');
        const onEdit = (editLine) => {
          rl.removeListener('line', onEdit);
          const edited = editLine.trim();
          if (edited) {
            req.approve(edited);
          } else {
            req.reject();
          }
        };
        rl.on('line', onEdit);
      } else {
        // Treat as custom message
        if (input) {
          req.approve(input);
        } else {
          req.reject();
        }
      }
    };

    rl.on('line', onLine);
  });

  // Allow manual injection via typing
  // (This is secondary to approval flow — only when not prompting)
  // In practice, the user would type a message and press Enter to inject it manually
  // This requires a separate input mechanism since stdin is shared with the PTY

  return {
    close() {
      rl.close();
    },
  };
}
