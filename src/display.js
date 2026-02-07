import { appendFileSync, writeFileSync } from 'fs';

export function createDisplay(config) {
  const logPath = config.logPath;
  const isActive = config.mode === 'active';
  const verbose = config.verbose || false;

  const findings = [];
  const actions = [];

  // Initialize log file
  if (isActive) {
    try {
      writeFileSync(logPath, `# Claude Auditor Live Log\n# Started: ${new Date().toISOString()}\n\n`, 'utf-8');
    } catch {
      // Non-fatal — may not have write permissions
    }
  }

  function timestamp() {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  function appendLog(line) {
    if (!isActive) return;
    try {
      appendFileSync(logPath, line + '\n', 'utf-8');
    } catch {
      // Non-fatal
    }
  }

  return {
    logFinding(finding) {
      findings.push(finding);

      const line = `[${timestamp()}] [${finding.severity}] ${finding.description}`;
      appendLog(line);

      if (verbose) {
        process.stderr.write(`[auditor] ${line}\n`);
      }
    },

    logAction(type, message, autoApproved) {
      const action = {
        type,
        message,
        autoApproved,
        timestamp: new Date().toISOString(),
      };
      actions.push(action);

      const line = `[${timestamp()}] [${type}] ${message}`;
      appendLog(line);

      if (verbose) {
        process.stderr.write(`[auditor] ${line}\n`);
      }
    },

    getFindings() {
      return findings;
    },

    getActions() {
      return actions;
    },
  };
}
