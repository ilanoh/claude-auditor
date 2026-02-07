import { EventEmitter } from 'events';
import { execFile } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// Directive patterns in auditor responses
const FINDING_RE = /\[FINDING:(CRITICAL|WARNING|INFO|SUGGESTION)\]\s*(.+)/g;
const INJECT_RE = /\[INJECT\]\s*(.+)/;
const INTERRUPT_RE = /\[INTERRUPT\]\s*(.+)/;
const RESOLVED_RE = /\[RESOLVED\]/;
const NO_FINDINGS_RE = /\[NO_FINDINGS\]/;

export function createAuditor(config, systemPrompt) {
  const emitter = new EventEmitter();
  const sessionId = uuidv4();
  const model = config.auditorModel || 'sonnet';
  const maxBudget = config.maxBudget || 1.0;
  const verbose = config.verbose || false;

  let totalCost = 0;
  let budgetExceeded = false;
  let chunkQueue = [];
  let processing = false;
  let drainResolve = null;

  function log(msg) {
    if (verbose) {
      process.stderr.write(`[auditor-brain] ${msg}\n`);
    }
  }

  function parseResponse(text) {
    const result = {
      findings: [],
      inject: null,
      interrupt: null,
      resolved: false,
      noFindings: false,
    };

    if (NO_FINDINGS_RE.test(text)) {
      result.noFindings = true;
      return result;
    }

    // Extract findings
    let match;
    const findingRe = /\[FINDING:(CRITICAL|WARNING|INFO|SUGGESTION)\]\s*(.+)/g;
    while ((match = findingRe.exec(text)) !== null) {
      result.findings.push({
        severity: match[1],
        description: match[2].trim(),
        timestamp: new Date().toISOString(),
      });
    }

    // Extract inject directive
    const injectMatch = INJECT_RE.exec(text);
    if (injectMatch) {
      result.inject = injectMatch[1].trim();
    }

    // Extract interrupt directive
    const interruptMatch = INTERRUPT_RE.exec(text);
    if (interruptMatch) {
      result.interrupt = interruptMatch[1].trim();
    }

    // Check resolved
    if (RESOLVED_RE.test(text)) {
      result.resolved = true;
    }

    return result;
  }

  function callClaude(prompt) {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--session-id', sessionId,
        '--model', model,
        '--output-format', 'json',
        '--no-session-persistence',
      ];

      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt);
      }

      log(`Calling claude with session ${sessionId}`);

      execFile('claude', args, {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
      }, (err, stdout, stderr) => {
        if (err) {
          log(`Claude call failed: ${err.message}`);
          reject(err);
          return;
        }

        try {
          const json = JSON.parse(stdout);
          // Extract cost if available
          if (json.cost_usd !== undefined) {
            totalCost += json.cost_usd;
          }
          // The result text is in json.result or json.text
          const text = json.result || json.text || json.content || stdout;
          resolve(typeof text === 'string' ? text : JSON.stringify(text));
        } catch {
          // Not JSON, use raw output
          resolve(stdout);
        }
      });
    });
  }

  async function processNext() {
    if (processing || chunkQueue.length === 0) {
      if (!processing && drainResolve) {
        drainResolve();
        drainResolve = null;
      }
      return;
    }

    processing = true;
    const { chunk, resolve: chunkResolve } = chunkQueue.shift();

    if (budgetExceeded) {
      log(`Budget exceeded ($${totalCost.toFixed(2)}/$${maxBudget}). Skipping chunk #${chunk.id}`);
      chunkResolve(null);
      processing = false;
      processNext();
      return;
    }

    try {
      const prompt = buildChunkPrompt(chunk);
      const response = await callClaude(prompt);
      const parsed = parseResponse(response);

      log(`Chunk #${chunk.id}: ${parsed.findings.length} findings, cost: $${totalCost.toFixed(4)}`);

      // Check budget
      if (totalCost >= maxBudget) {
        budgetExceeded = true;
        process.stderr.write(`[auditor] Budget limit reached ($${totalCost.toFixed(2)}/$${maxBudget}). Stopping analysis.\n`);
      }

      chunkResolve(parsed);
    } catch (err) {
      log(`Error analyzing chunk #${chunk.id}: ${err.message}`);
      chunkResolve(null);
    }

    processing = false;
    processNext();
  }

  function buildChunkPrompt(chunk) {
    // Recalibration prompts are sent as-is
    if (chunk._rawPrompt) {
      return chunk.content;
    }

    const toolInfo = chunk.detectedTools.length > 0
      ? `\nDetected tools in this chunk: ${chunk.detectedTools.join(', ')}`
      : '';

    return `AUDIT CHUNK #${chunk.id} (${chunk.lineCount} lines, ${chunk.timestamp}):${toolInfo}

${chunk.content}

Analyze this chunk. Output ONLY directives as specified in your instructions.`;
  }

  // Public API

  emitter.analyzeChunk = (chunk) => {
    return new Promise((resolve) => {
      chunkQueue.push({ chunk, resolve });
      processNext();
    });
  };

  emitter.sendRecalibrationPrompt = (workerResponse) => {
    const prompt = `Worker responded to your interrupt/injection:

"${workerResponse}"

Is the worker now aligned with the correct approach? If not, what else needs correcting?
Respond with either:
- [INJECT] <follow-up correction> — if more guidance needed
- [RESOLVED] — if the worker is back on track`;

    return new Promise((resolve) => {
      chunkQueue.push({
        chunk: {
          id: 'recal',
          lineCount: 0,
          timestamp: new Date().toISOString(),
          content: prompt,
          detectedTools: [],
          _rawPrompt: true,
        },
        resolve: (parsed) => resolve(parsed),
      });

      // Override processNext for recalibration — use raw prompt
      processNext();
    });
  };

  emitter.drain = () => {
    if (!processing && chunkQueue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      drainResolve = resolve;
    });
  };

  emitter.getTotalCost = () => totalCost;
  emitter.getSessionId = () => sessionId;
  emitter.isBudgetExceeded = () => budgetExceeded;

  return emitter;
}
