import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import pty from 'node-pty';

function resolveCommand(cmd) {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim();
  } catch {
    return cmd;
  }
}

export function createProxy(config) {
  const emitter = new EventEmitter();
  const claudeArgs = config.claudeArgs || [];

  // Detect terminal size
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  // Resolve full path — node-pty requires it on some platforms
  const claudePath = resolveCommand('claude');

  // Spawn claude in a PTY
  const ptyProcess = pty.spawn(claudePath, claudeArgs, {
    name: process.env.TERM || 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env,
  });

  // Track idle state: true when worker is waiting for user input
  let lastOutputTime = Date.now();
  let idleTimer = null;
  let _isIdle = false;

  // Forward PTY output → stdout + emit for chunker
  ptyProcess.onData((data) => {
    process.stdout.write(data);
    emitter.emit('data', data);

    lastOutputTime = Date.now();
    _isIdle = false;

    // Reset idle detection
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      _isIdle = true;
      emitter.emit('idle');
    }, 3000);
  });

  // Forward stdin → PTY (raw mode for proper key handling)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', (data) => {
    ptyProcess.write(data.toString());
  });

  // Handle terminal resize
  process.stdout.on('resize', () => {
    const newCols = process.stdout.columns || 80;
    const newRows = process.stdout.rows || 24;
    ptyProcess.resize(newCols, newRows);
  });

  // Handle PTY exit
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (idleTimer) clearTimeout(idleTimer);

    // Restore terminal
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();

    emitter.emit('exit', { exitCode, signal });
  });

  // Public API
  emitter.inject = (message) => {
    // Write message + Enter to the PTY stdin
    ptyProcess.write(message + '\r');
  };

  emitter.sendEscape = () => {
    // Send Escape key to cancel worker input
    ptyProcess.write('\x1b');
  };

  emitter.isIdle = () => {
    return _isIdle;
  };

  emitter.kill = (signal) => {
    ptyProcess.kill(signal || 'SIGTERM');
  };

  emitter.getPty = () => ptyProcess;

  return emitter;
}
