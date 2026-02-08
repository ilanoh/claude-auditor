import { execSync, spawn } from 'child_process';

/**
 * Auto-open a split terminal pane that tails the audit log.
 * Supports: tmux, iTerm2, Terminal.app, Ghostty, Kitty.
 * Returns a cleanup function that closes the pane on exit.
 */
export function openAuditorPane(logPath) {
  // tmux — best experience, native split
  if (process.env.TMUX) {
    return openTmuxPane(logPath);
  }

  // iTerm2
  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return openItermPane(logPath);
  }

  // Ghostty
  if (process.env.TERM_PROGRAM === 'ghostty') {
    return openGhosttyPane(logPath);
  }

  // Kitty
  if (process.env.TERM_PROGRAM === 'kitty') {
    return openKittyPane(logPath);
  }

  // macOS Terminal.app — fallback
  if (process.platform === 'darwin') {
    return openTerminalTab(logPath);
  }

  // No supported terminal detected — no pane
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

function openItermPane(logPath) {
  try {
    const script = `
      tell application "iTerm2"
        tell current session of current window
          set newSession to (split vertically with default profile)
          tell newSession
            write text "tail -f '${logPath}' && exit"
          end tell
        end tell
      end tell
    `;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

    return {
      close() {
        // iTerm will close when tail ends (session exits)
      }
    };
  } catch {
    return null;
  }
}

function openGhosttyPane(logPath) {
  try {
    // Ghostty supports new-tab via CLI or keybind, but not split via CLI.
    // Fall back to new window
    spawn('ghostty', ['-e', `tail -f '${logPath}'`], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    return { close() {} };
  } catch {
    return null;
  }
}

function openKittyPane(logPath) {
  try {
    execSync(`kitty @ launch --type=window tail -f '${logPath}'`);
    return { close() {} };
  } catch {
    return null;
  }
}

function openTerminalTab(logPath) {
  try {
    const script = `
      tell application "Terminal"
        activate
        do script "tail -f '${logPath}'"
      end tell
    `;
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);

    return {
      close() {
        // Can't easily close Terminal.app tabs programmatically
      }
    };
  } catch {
    return null;
  }
}
