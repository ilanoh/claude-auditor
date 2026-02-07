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
    chunker.feed('Hello world\nThis is a test\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].id, 1);
    assert.ok(chunks[0].content.includes('Hello world'));
    assert.ok(chunks[0].content.includes('This is a test'));
  });

  it('should strip ANSI codes from content', () => {
    chunker.feed('\x1b[31mRed text\x1b[0m and \x1b[1mbold\x1b[0m\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('Red text'));
    assert.ok(!chunks[0].content.includes('\x1b['));
  });

  it('should flush when buffer exceeds size cap (200 lines)', () => {
    // Feed 250 non-empty lines
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join('\n') + '\n';
    chunker.feed(lines);

    // Should have flushed at least once due to size cap
    assert.ok(chunks.length >= 1, `Expected at least 1 chunk, got ${chunks.length}`);
  });

  it('should detect tool patterns in chunks', () => {
    chunker.feed('  Read file /src/index.js\n  Contents of file...\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].detectedTools.includes('Read'));
  });

  it('should detect boundary patterns and split chunks', () => {
    // Feed content with a boundary in the middle
    // Need > 5 lines before boundary to trigger flush
    chunker.feed('Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\n');
    chunker.feed('───────────────────\n');
    chunker.feed('After boundary\n');
    chunker.flush();

    // Should have 2 chunks: before boundary and boundary + after
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
  });

  it('should assign incrementing chunk IDs', () => {
    chunker.feed('First chunk\n');
    chunker.flush();
    chunker.feed('Second chunk\n');
    chunker.flush();

    assert.equal(chunks[0].id, 1);
    assert.equal(chunks[1].id, 2);
  });

  it('should not emit empty chunks', () => {
    chunker.flush(); // Nothing in buffer
    assert.equal(chunks.length, 0);
  });

  it('should track stats correctly', () => {
    chunker.feed('Line 1\nLine 2\n  Read file test\n');
    chunker.flush();
    chunker.feed('Line 3\n  Bash command\n');
    chunker.flush();

    const stats = chunker.getStats();
    assert.equal(stats.totalChunks, 2);
    assert.ok(stats.totalLines >= 4);
    assert.ok(stats.detectedTools.Read >= 1);
    assert.ok(stats.detectedTools.Bash >= 1);
  });

  it('should include timestamp in chunks', () => {
    chunker.feed('Test line\n');
    chunker.flush();

    assert.ok(chunks[0].timestamp);
    // Should be a valid ISO string
    assert.ok(!isNaN(Date.parse(chunks[0].timestamp)));
  });

  it('should skip empty lines', () => {
    chunker.feed('\n\n\nActual content\n\n\n');
    chunker.flush();

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('Actual content'));
    // lineCount should reflect non-empty lines
    assert.equal(chunks[0].lineCount, 1);
  });
});
