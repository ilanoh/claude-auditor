import { Command } from 'commander';
import { createProxy } from './proxy.js';
import { createChunker } from './chunker.js';
import { createAuditor } from './auditor.js';
import { createSupervisor } from './supervisor.js';
import { createDisplay } from './display.js';
import { createReporter } from './reporter.js';
import { createConsole } from './console.js';
import { buildSystemPrompt } from './prompts/base.js';

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
    .option('--verbose', 'Show auditor activity in stderr', false)
    .option('--no-report', 'Skip final report generation')
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
    claudeArgs,
  };

  if (config.verbose) {
    process.stderr.write(`[auditor] Config: ${JSON.stringify(config, null, 2)}\n`);
  }

  startSession(config);
}

function startSession(config) {
  const systemPrompt = buildSystemPrompt(config.focusAreas);
  const display = createDisplay(config);
  const reporter = createReporter(config);
  const chunker = createChunker(config);
  const auditor = createAuditor(config, systemPrompt);
  const proxy = createProxy(config);
  const supervisor = createSupervisor(config, proxy, auditor, display);

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

  // Wire: proxy exit → final report
  proxy.on('exit', async (exitInfo) => {
    chunker.flush();

    // Wait for any pending auditor analysis
    await auditor.drain();

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
        process.stderr.write(`\n[auditor] Report written to ${config.outputPath}\n`);
      } catch (err) {
        process.stderr.write(`\n[auditor] Failed to write report: ${err.message}\n`);
      }
    }

    if (auditConsole) {
      auditConsole.close();
    }

    process.stderr.write(`[auditor] Session ended. Findings: ${display.getFindings().length}\n`);
    process.exit(exitInfo.exitCode || 0);
  });

  const startTime = Date.now();

  // Graceful shutdown
  const shutdown = () => {
    process.stderr.write('\n[auditor] Shutting down...\n');
    chunker.flush();
    proxy.kill();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (config.verbose) {
    process.stderr.write(`[auditor] Session started. Log: ${config.logPath}\n`);
    process.stderr.write(`[auditor] Autonomy: ${config.autonomy} | Mode: ${config.mode}\n`);
  }
}
