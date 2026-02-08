import { appendFileSync, writeFileSync } from 'fs';

let _logPath = null;
let _initialized = false;

/**
 * Centralized logger that writes ONLY to the log file.
 * Never writes to stderr/stdout — those belong to the PTY.
 */

export function initLogger(logPath) {
  _logPath = logPath;
  try {
    writeFileSync(logPath, `# Claude Auditor Log\n# Started: ${new Date().toISOString()}\n\n`, 'utf-8');
    _initialized = true;
  } catch {
    // Non-fatal
  }
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function log(tag, msg) {
  if (!_initialized) return;
  try {
    appendFileSync(_logPath, `[${timestamp()}] [${tag}] ${msg}\n`, 'utf-8');
  } catch {
    // Non-fatal
  }
}

export function logRaw(msg) {
  if (!_initialized) return;
  try {
    appendFileSync(_logPath, msg + '\n', 'utf-8');
  } catch {
    // Non-fatal
  }
}

export function getLogPath() {
  return _logPath;
}
