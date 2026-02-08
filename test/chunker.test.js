import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createChunker } from '../src/chunker.js';

describe('Chunker', () => {
  let chunker;
  let chunks;

  beforeEach(() => {
    chunks = [];
    chunker = createChunker({ chunkInterval: 60 }); // Long interval so only explicit triggers fire
    chunker.on('chunk', (chunk) => chunks.push(chunk));
  });

  it('should emit a chunk on manual flush', () => {
    chunker.feed('Hello world this is a test line\nSecond line of content here\nThird line of real content\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, 1);
    assert.ok(chunks[0].content.includes('Hello world'));
  });

  it('should strip ANSI codes from content', () => {
    chunker.feed('\x1b[31mRed text with some content\x1b[0m\nAnother line of output here\nThird line for minimum\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('Red text'));
    assert.ok(!chunks[0].content.includes('\x1b['));
  });

  it('should flush when buffer exceeds size cap (200 lines)', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1} with enough content to not be filtered`).join('\n') + '\n';
    chunker.feed(lines);

    assert.ok(chunks.length >= 1, `Expected at least 1 chunk, got ${chunks.length}`);
  });

  it('should detect tool patterns in chunks', () => {
    chunker.feed('  Read file /src/index.js\n  Contents of file here...\n  More file content below\n  const x = 1\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].detectedTools.includes('Read'));
  });

  it('should detect boundary patterns and split chunks', () => {
    chunker.feed('Line 1 with content\nLine 2 with content\nLine 3 with content\nLine 4 with content\nLine 5 with content\nLine 6 with content\n');
    chunker.feed('───────────────────\n');
    chunker.feed('After boundary line one\nAfter boundary line two\nAfter boundary line three\n');
    chunker.flush();

    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  });

  it('should assign incrementing chunk IDs', () => {
    chunker.feed('First chunk line one content\nFirst chunk line two content\nFirst chunk line three\n');
    chunker.flush();
    chunker.feed('Second chunk line one content\nSecond chunk line two content\nSecond chunk line three\n');
    chunker.flush();

    assert.equal(chunks[0].id, 1);
    assert.equal(chunks[1].id, 2);
  });

  it('should not emit empty chunks', () => {
    chunker.flush();
    assert.equal(chunks.length, 0);
  });

  it('should track stats correctly', () => {
    chunker.feed('Line 1 content here\nLine 2 content here\n  Read file test content\n');
    chunker.flush();
    chunker.feed('Line 3 content here\n  Bash command running\nLine 4 output content\n');
    chunker.flush();

    const stats = chunker.getStats();
    assert.equal(stats.totalChunks, 2);
    assert.ok(stats.totalLines >= 4);
    assert.ok(stats.detectedTools.Read >= 1);
    assert.ok(stats.detectedTools.Bash >= 1);
  });

  it('should include timestamp in chunks', () => {
    chunker.feed('Test line with enough content\nAnother test line here\nThird test line present\n');
    chunker.flush();

    assert.ok(chunks[0].timestamp);
    assert.ok(!isNaN(Date.parse(chunks[0].timestamp)));
  });

  it('should filter out tiny noise chunks', () => {
    chunker.feed('hi\n');
    chunker.flush();

    // Single short line should be filtered
    assert.equal(chunks.length, 0);
  });

  it('should filter out terminal noise lines', () => {
    chunker.feed('Puzzling...\nUpdate available! Run: brew upgrade\n│ some box content\n');
    chunker.flush();

    assert.equal(chunks.length, 0);
  });
});
