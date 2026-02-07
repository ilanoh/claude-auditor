import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createReporter } from '../src/reporter.js';

describe('Reporter', () => {
  const config = {
    autonomy: 'supervised',
  };

  const reporter = createReporter(config);

  it('should generate a markdown report with all sections', () => {
    const report = reporter.generate({
      findings: [
        { severity: 'CRITICAL', description: 'SQL injection in login endpoint', timestamp: '2026-02-08T12:00:00Z' },
        { severity: 'WARNING', description: 'Missing input validation', timestamp: '2026-02-08T12:01:00Z' },
        { severity: 'SUGGESTION', description: 'Consider using prepared statements', timestamp: '2026-02-08T12:02:00Z' },
      ],
      actions: [
        { type: 'INJECT', message: 'Add parameterized queries', autoApproved: false, timestamp: '2026-02-08T12:01:30Z' },
        { type: 'INTERRUPT', message: 'Architecture mismatch', autoApproved: false, timestamp: '2026-02-08T12:03:00Z' },
      ],
      chunks: { totalChunks: 15, totalLines: 450, detectedTools: { Read: 5, Edit: 3, Bash: 7 } },
      auditorCost: 0.0523,
      auditorModel: 'sonnet',
      focusAreas: ['security', 'quality'],
      duration: 300000,
      exitCode: 0,
    });

    // Check structure
    assert.ok(report.includes('# Audit Report'));
    assert.ok(report.includes('## Summary'));
    assert.ok(report.includes('## Findings'));
    assert.ok(report.includes('## Action Log'));
    assert.ok(report.includes('## Session Statistics'));

    // Check findings
    assert.ok(report.includes('1 critical finding'));
    assert.ok(report.includes('1 warning'));
    assert.ok(report.includes('1 suggestion'));
    assert.ok(report.includes('SQL injection'));
    assert.ok(report.includes('Missing input validation'));

    // Check actions
    assert.ok(report.includes('INJECT'));
    assert.ok(report.includes('INTERRUPT'));
    assert.ok(report.includes('Add parameterized queries'));

    // Check stats
    assert.ok(report.includes('Total chunks analyzed: 15'));
    assert.ok(report.includes('Read: 5'));
    assert.ok(report.includes('Edit: 3'));
    assert.ok(report.includes('Bash: 7'));

    // Check metadata
    assert.ok(report.includes('sonnet'));
    assert.ok(report.includes('$0.0523'));
    assert.ok(report.includes('security, quality'));
    assert.ok(report.includes('5 minutes'));
  });

  it('should handle empty findings', () => {
    const report = reporter.generate({
      findings: [],
      actions: [],
      chunks: { totalChunks: 3, totalLines: 50, detectedTools: {} },
      auditorCost: 0.001,
      auditorModel: 'haiku',
      focusAreas: [],
      duration: 60000,
      exitCode: 0,
    });

    assert.ok(report.includes('0 critical findings'));
    assert.ok(report.includes('No findings were identified'));
    assert.ok(!report.includes('## Action Log'));
  });

  it('should pluralize correctly', () => {
    const report = reporter.generate({
      findings: [
        { severity: 'CRITICAL', description: 'One critical', timestamp: '2026-02-08T12:00:00Z' },
      ],
      actions: [],
      chunks: { totalChunks: 1, totalLines: 10, detectedTools: {} },
      auditorCost: 0,
      auditorModel: 'sonnet',
      focusAreas: [],
      duration: 10000,
      exitCode: 0,
    });

    assert.ok(report.includes('1 critical finding'));
    assert.ok(!report.includes('1 critical findings'));
  });
});
