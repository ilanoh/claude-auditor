import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/prompts/base.js';

describe('System Prompt Builder', () => {
  it('should return base prompt with no focus areas', () => {
    const prompt = buildSystemPrompt([]);
    assert.ok(prompt.includes('senior code auditor'));
    assert.ok(prompt.includes('[NO_FINDINGS]'));
    assert.ok(!prompt.includes('SECURITY FOCUS'));
    assert.ok(!prompt.includes('QUALITY FOCUS'));
  });

  it('should include security overlay', () => {
    const prompt = buildSystemPrompt(['security']);
    assert.ok(prompt.includes('senior code auditor'));
    assert.ok(prompt.includes('SECURITY FOCUS'));
    assert.ok(prompt.includes('SQL injection'));
  });

  it('should include quality overlay', () => {
    const prompt = buildSystemPrompt(['quality']);
    assert.ok(prompt.includes('CODE QUALITY FOCUS'));
    assert.ok(prompt.includes('Deep nesting'));
  });

  it('should include compliance overlay', () => {
    const prompt = buildSystemPrompt(['compliance']);
    assert.ok(prompt.includes('SPEC COMPLIANCE FOCUS'));
  });

  it('should include performance overlay', () => {
    const prompt = buildSystemPrompt(['performance']);
    assert.ok(prompt.includes('PERFORMANCE FOCUS'));
    assert.ok(prompt.includes('N+1'));
  });

  it('should combine multiple focus areas', () => {
    const prompt = buildSystemPrompt(['security', 'quality', 'performance']);
    assert.ok(prompt.includes('SECURITY FOCUS'));
    assert.ok(prompt.includes('CODE QUALITY FOCUS'));
    assert.ok(prompt.includes('PERFORMANCE FOCUS'));
    assert.ok(!prompt.includes('SPEC COMPLIANCE FOCUS'));
  });

  it('should ignore unknown focus areas', () => {
    const prompt = buildSystemPrompt(['security', 'unknown', 'nonexistent']);
    assert.ok(prompt.includes('SECURITY FOCUS'));
    // Should not throw
  });
});

describe('Auditor Response Parsing', () => {
  // Test the parsing logic indirectly via module import
  it('should be testable via auditor module', async () => {
    // We can't easily test the full auditor without claude being installed,
    // but we can verify the module loads correctly
    const { createAuditor } = await import('../src/auditor.js');
    assert.ok(typeof createAuditor === 'function');
  });
});

describe('Module Loading', () => {
  it('should load all modules without errors', async () => {
    const modules = [
      '../src/proxy.js',
      '../src/chunker.js',
      '../src/auditor.js',
      '../src/supervisor.js',
      '../src/console.js',
      '../src/display.js',
      '../src/reporter.js',
      '../src/prompts/base.js',
    ];

    for (const mod of modules) {
      const imported = await import(mod);
      assert.ok(imported, `Module ${mod} should export something`);
    }
  });
});
