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
    // Split, run tail, then refocus original pane
    const script =
`tell application "iTerm2"
  tell current session of current window
    set auditorSession to (split vertically with default profile)
    tell auditorSession
      write text "clear && printf '\\033[1;36m── Claude Auditor ──\\033[0m\\n' && tail -f '${logPath}'"
    end tell
  end tell
end tell`;

    execFileSync('osascript', ['-e', script], { encoding: 'utf-8', timeout: 5000 });

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
        try {
          const closeScript =
`tell application "iTerm2"
  tell current tab of current window
    set sessionCount to count of sessions
    if sessionCount > 1 then
      tell last session
        close
      end tell
    end if
  end tell
end tell`;
          execFileSync('osascript', ['-e', closeScript], { timeout: 5000 });
        } catch {}
      }
    };
  } catch {
    return null;
  }
}
