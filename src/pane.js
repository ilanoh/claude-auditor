import { execSync, spawn, execFileSync } from 'child_process';
import { writeFileSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Auto-open a split/second terminal pane showing the audit log.
 * Strategy:
 *   1. tmux → native split pane (best)
 *   2. macOS → open a new terminal window via `open -a Terminal` with a script
 *   3. Linux → try common terminal emulators
 */
export function openAuditorPane(logPath) {
  // Already in tmux → split pane
  if (process.env.TMUX) {
    return openTmuxPane(logPath);
  }

  // macOS — works with ANY terminal (opens a separate Terminal.app window)
  if (process.platform === 'darwin') {
    return openMacPane(logPath);
  }

  // Linux — try common terminals
  if (process.platform === 'linux') {
    return openLinuxPane(logPath);
  }

  return null;
}

function openTmuxPane(logPath) {
  try {
    const paneId = execSync(
      `tmux split-window -h -d -P -F '#{pane_id}' "tail -f '${logPath}'"`,
      { encoding: 'utf-8' }
    ).trim();

    return {
      close() {
        try { execSync(`tmux kill-pane -t '${paneId}' 2>/dev/null`); } catch {}
      }
    };
  } catch {
    return null;
  }
}

function openMacPane(logPath) {
  try {
    // Write a small shell script that tails the log with a nice header
    const scriptPath = join(tmpdir(), `claude-auditor-tail-${process.pid}.sh`);
    writeFileSync(scriptPath, [
      '#!/bin/bash',
      'clear',
      'printf "\\033[1;36m── Claude Auditor ──\\033[0m\\n\\n"',
      `tail -f "${logPath}"`,
    ].join('\n'), 'utf-8');
    chmodSync(scriptPath, 0o755);

    // `open -a Terminal <script>` works regardless of what terminal the user runs claude-auditor in
    spawn('open', ['-a', 'Terminal', scriptPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    return {
      close() {
        // Terminal.app window will stay open (user closes manually)
        // Clean up the temp script
        try { execSync(`rm -f "${scriptPath}" 2>/dev/null`); } catch {}
      }
    };
  } catch {
    return null;
  }
}

function openLinuxPane(logPath) {
  // Try common Linux terminal emulators in order of popularity
  const terminals = [
    { cmd: 'gnome-terminal', args: ['--', 'tail', '-f', logPath] },
    { cmd: 'konsole', args: ['-e', 'tail', '-f', logPath] },
    { cmd: 'xfce4-terminal', args: ['-e', `tail -f "${logPath}"`] },
    { cmd: 'xterm', args: ['-e', 'tail', '-f', logPath] },
  ];

  for (const { cmd, args } of terminals) {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      return { close() {} };
    } catch {
      continue;
    }
  }

  return null;
}
