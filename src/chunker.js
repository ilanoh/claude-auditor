import { EventEmitter } from 'events';
import stripAnsi from 'strip-ansi';

// Boundary patterns that indicate tool call / section transitions
const BOUNDARY_PATTERNS = [
  /^[─═]{3,}/,                                  // Horizontal rules
  /^\s*(Read|Edit|Write|Bash|Grep|Glob|Task)\s/, // Tool call markers
  /^(✓|✗|⚠|❌|✅)/,                             // Status indicators
  /^[>$#]\s/,                                    // Shell prompts
  /^╭─/,                                         // Box drawing start
  /^╰─/,                                         // Box drawing end
  /^⏺/,                                         // Claude Code activity markers
];

// Patterns that indicate which tool was invoked
const TOOL_PATTERNS = {
  Read: /\b(Read|Reading)\s+(file|\/)/i,
  Edit: /\b(Edit|Editing)\s/i,
  Write: /\b(Write|Writing)\s+(file|to\s+\/)/i,
  Bash: /\b(Bash|Running|command)\s/i,
  Grep: /\b(Grep|Searching|Search)\s/i,
  Glob: /\b(Glob|Finding files)\s/i,
  Task: /\b(Task|Agent|Spawning)\s/i,
};

const SIZE_CAP = 200;       // Max lines before forced flush
const DEBOUNCE_MS = 2000;   // Flush after output stops for 2s

export function createChunker(config) {
  const emitter = new EventEmitter();
  const chunkInterval = (config.chunkInterval || 30) * 1000;

  let buffer = [];
  let chunkId = 0;
  let totalChunks = 0;
  let totalLines = 0;
  let detectedToolsAll = {};

  let debounceTimer = null;
  let intervalTimer = null;
  let pendingBoundary = false;

  function detectTools(lines) {
    const tools = new Set();
    for (const line of lines) {
      for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
        if (pattern.test(line)) {
          tools.add(tool);
        }
      }
    }
    return [...tools];
  }

  function isBoundary(line) {
    return BOUNDARY_PATTERNS.some(p => p.test(line));
  }

  function doFlush() {
    if (buffer.length === 0) return;

    const lines = buffer.slice();
    buffer = [];
    pendingBoundary = false;

    chunkId++;
    totalChunks++;
    totalLines += lines.length;
    const detectedTools = detectTools(lines);

    for (const t of detectedTools) {
      detectedToolsAll[t] = (detectedToolsAll[t] || 0) + 1;
    }

    const chunk = {
      id: chunkId,
      timestamp: new Date().toISOString(),
      lineCount: lines.length,
      content: lines.join('\n'),
      detectedTools,
    };

    emitter.emit('chunk', chunk);

    // Reset interval timer
    if (intervalTimer) clearTimeout(intervalTimer);
    intervalTimer = setTimeout(() => doFlush(), chunkInterval);
  }

  function resetDebounce() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => doFlush(), DEBOUNCE_MS);
  }

  // Start periodic flush timer
  intervalTimer = setTimeout(() => doFlush(), chunkInterval);

  emitter.feed = (rawData) => {
    // Strip ANSI codes
    const clean = stripAnsi(rawData);

    // Split into lines
    const lines = clean.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if this line is a boundary
      if (isBoundary(trimmed) && buffer.length > 5) {
        // Flush what we have before this boundary
        doFlush();
        pendingBoundary = true;
      }

      buffer.push(line);

      // Size cap: flush immediately when buffer is too large
      if (buffer.length >= SIZE_CAP) {
        doFlush();
      }
    }

    // Reset debounce on every feed
    resetDebounce();
  };

  emitter.flush = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (intervalTimer) clearTimeout(intervalTimer);
    doFlush();
  };

  emitter.getStats = () => ({
    totalChunks,
    totalLines,
    detectedTools: { ...detectedToolsAll },
  });

  return emitter;
}
