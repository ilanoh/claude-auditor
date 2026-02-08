import { Command } from 'commander';
import { createProxy } from './proxy.js';
import { createChunker } from './chunker.js';
import { createAuditor } from './auditor.js';
import { createSupervisor } from './supervisor.js';
import { createDisplay } from './display.js';
import { createReporter } from './reporter.js';
import { createConsole } from './console.js';
import { buildSystemPrompt } from './prompts/base.js';
import { initLogger, log } from './logger.js';
import { openAuditorPane } from './pane.js';

export function run(argv) {
  const program = new Command();

  program
    .name('claude-auditor')
    .description('Real-time AI session auditor for Claude Code')
    .version('1.0.0')
    .option('--mode <mode>', 'Analysis mode: passive or active', 'passive')
    .option('--focus <areas>', 'Comma-separated focus areas: security,quality,compliance,performance', '')
    .option('--auditor-model <model>', 'Model for auditor brain', 'sonnet')
    .option('--output <path>', 'Report output path', './audit-report.md')
    .option('--log <path>', 'Live findings log path')
    .option('--max-budget <usd>', 'Max auditor spend in USD', parseFloat, 1.0)
    .option('--chunk-interval <seconds>', 'Time-based chunk flush interval', parseInt, 30)
    .option('--autonomy <level>', 'Autonomy level: full, supervised, observe', 'supervised')
    .option('--verbose', 'Show auditor activity in log', false)
    .option('--no-report', 'Skip final report generation')
    .option('--no-pane', 'Don\'t auto-open auditor pane', false)
    .allowUnknownOption(true)
    .allowExcessArguments(true);

  // Parse everything before '--', pass the rest to claude
  const sepIdx = argv.indexOf('--');
  let cliArgs, claudeArgs;

  if (sepIdx !== -1) {
    cliArgs = argv.slice(0, sepIdx);
    claudeArgs = argv.slice(sepIdx + 1);
  } else {
    cliArgs = argv;
    claudeArgs = [];
  }

  program.parse(cliArgs);
  const opts = program.opts();

  // Defaults
  const logPath = opts.log || `/tmp/claude-audit-${process.pid}.log`;
  const focusAreas = opts.focus ? opts.focus.split(',').map(s => s.trim()).filter(Boolean) : [];

  const config = {
    mode: opts.mode,
    focusAreas,
    auditorModel: opts.auditorModel,
    outputPath: opts.output,
    logPath,
    maxBudget: opts.maxBudget,
    chunkInterval: opts.chunkInterval,
    autonomy: opts.autonomy,
    verbose: opts.verbose,
    generateReport: opts.report !== false,
    openPane: opts.pane !== false,
    claudeArgs,
  };

  // Initialize logger FIRST — all output goes to log file, never stderr
  initLogger(logPath);
  log('config', JSON.stringify(config));

  startSession(config);
}

function startSession(config) {
  const systemPrompt = buildSystemPrompt(config.focusAreas);
  const display = createDisplay();
  const reporter = createReporter(config);
  const chunker = createChunker(config);
  const auditor = createAuditor(config, systemPrompt);
  const proxy = createProxy(config);
  const supervisor = createSupervisor(config, proxy, auditor, display);

  // Auto-open split pane for live auditor output
  let pane = null;
  if (config.openPane) {
    pane = openAuditorPane(config.logPath);
    if (pane) {
      log('pane', 'Auditor pane opened');
    } else {
      log('pane', 'Could not auto-open pane');
    }
  }

  let auditConsole = null;
  if (config.autonomy === 'supervised' && config.mode === 'active') {
    auditConsole = createConsole(supervisor, display);
  }

  // Wire: proxy output → chunker
  proxy.on('data', (data) => {
    chunker.feed(data);
  });

  // Wire: chunker → supervisor (which routes to auditor)
  chunker.on('chunk', (chunk) => {
    supervisor.processChunk(chunk);
  });

  // Wire: supervisor findings → display
  supervisor.on('finding', (finding) => {
    display.logFinding(finding);
  });

  supervisor.on('inject', ({ message, autoApproved }) => {
    display.logAction('INJECT', message, autoApproved);
  });

  supervisor.on('interrupt', ({ reason }) => {
    display.logAction('INTERRUPT', reason, false);
  });

  supervisor.on('recalibrate', ({ turn, message }) => {
    display.logAction('RECALIBRATE', `Turn ${turn}: ${message}`, false);
  });

  supervisor.on('resolved', () => {
    display.logAction('RESOLVED', 'Worker back on track', false);
  });

  const startTime = Date.now();
  let exiting = false;

  // Wire: proxy exit → final report
  proxy.on('exit', async (exitInfo) => {
    if (exiting) return;
    exiting = true;

    chunker.flush();

    // Wait for pending auditor analysis — with timeout so we don't hang
    const drainTimeout = new Promise(r => setTimeout(r, 5000));
    await Promise.race([auditor.drain(), drainTimeout]);

    if (config.generateReport) {
      const report = reporter.generate({
        findings: display.getFindings(),
        actions: display.getActions(),
        chunks: chunker.getStats(),
        auditorCost: auditor.getTotalCost(),
        auditorModel: config.auditorModel,
        focusAreas: config.focusAreas,
        duration: Date.now() - startTime,
        exitCode: exitInfo.exitCode,
      });

      try {
        const fs = await import('fs');
        fs.writeFileSync(config.outputPath, report, 'utf-8');
        log('report', `Written to ${config.outputPath}`);
      } catch (err) {
        log('report', `Failed to write: ${err.message}`);
      }
    }

    if (auditConsole) auditConsole.close();
    if (pane) pane.close();

    log('session', `Ended. Findings: ${display.getFindings().length}`);

    // Force exit — don't let pending promises keep the process alive
    process.exit(exitInfo.exitCode || 0);
  });

  // Graceful shutdown — Ctrl+C in raw mode sends 0x03 to the PTY child,
  // but if the child exits, onExit handles cleanup.
  // If somehow SIGINT reaches us, handle it:
  let sigintCount = 0;
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount >= 2) {
      // Force kill on double Ctrl+C
      if (pane) pane.close();
      process.exit(1);
    }
    chunker.flush();
    proxy.kill();
  });

  process.on('SIGTERM', () => {
    chunker.flush();
    proxy.kill();
  });

  log('session', `Started. Autonomy: ${config.autonomy} | Mode: ${config.mode}`);
}
