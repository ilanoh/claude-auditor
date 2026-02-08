import { execFileSync, execSync } from 'child_process';

/**
 * Open an auditor pane that tails the log file.
 * Detects the terminal and uses native split where possible.
 */
export function openAuditorPane(logPath) {
  if (process.env.TMUX) {
    return openTmuxPane(logPath);
  }

  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    return openItermPane(logPath);
  }

  // Fallback: no pane, user can tail -f manually
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
    // Split and capture the new session's ID
    const tailCmd = `clear && echo '── Claude Auditor ──' && tail -f ${logPath}`;
    const script =
`tell application "iTerm2"
  tell current session of current window
    set auditorSession to (split vertically with default profile)
    tell auditorSession
      write text "${tailCmd}"
      return id
    end tell
  end tell
end tell`;

    const sessionId = execFileSync('osascript', ['-e', script], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    // Refocus the left (original) pane so the user stays in claude
    const focusScript =
`tell application "iTerm2"
  tell current tab of current window
    select (first session)
  end tell
end tell`;

    execFileSync('osascript', ['-e', focusScript], { encoding: 'utf-8', timeout: 5000 });

    return {
      close() {
        if (!sessionId) return;
        try {
          // Close the specific auditor session by ID
          const closeScript =
`tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if id of s is "${sessionId}" then
          tell s to close
          return
        end if
      end repeat
    end repeat
  end repeat
end tell`;
          execFileSync('osascript', ['-e', closeScript], { timeout: 5000 });
        } catch {}
      }
    };
  } catch {
    return null;
  }
}
