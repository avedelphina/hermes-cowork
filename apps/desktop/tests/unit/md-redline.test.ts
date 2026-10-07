// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertReviewable,
  detectMdr,
  extractComments,
  insertComment,
  reviewPrompt,
  stripForReview,
} from '@main/review/md-redline';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'mdr-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('detectMdr', () => {
  it('reports unavailable when PATH has no mdr', () => {
    expect(detectMdr({ env: { ...process.env, PATH: root } })).toEqual({ available: false });
  });

  it('returns the stub on PATH without spawning a server', () => {
    const bin = join(root, 'mdr');
    writeFileSync(bin, '#!/bin/sh\necho should-not-run\n');
    chmodSync(bin, 0o755);
    const found = detectMdr({ env: { ...process.env, PATH: root } });
    expect(found).toEqual({ available: true, bin });
  });
});

describe('assertReviewable', () => {
  it('accepts an in-root markdown file', () => {
    writeFileSync(join(root, 'spec.md'), '# spec\n');
    expect(assertReviewable(root, 'spec.md')).toBe(join(root, 'spec.md'));
  });

  it('rejects traversal before any launch', () => {
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'secret.md'), 'nope\n');
    expect(() => assertReviewable(root, 'sub/../../secret.md')).toThrow(/escapes/i);
  });

  it('rejects a symlink whose target leaves the root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mdr-out-'));
    try {
      writeFileSync(join(outside, 'notes.md'), 'outside\n');
      symlinkSync(join(outside, 'notes.md'), join(root, 'notes.md'));
      expect(() => assertReviewable(root, 'notes.md')).toThrow(/escapes/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects instruction files', () => {
    writeFileSync(join(root, 'AGENTS.md'), 'rules\n');
    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'rules', 'style.mdc'), 'style\n');
    expect(() => assertReviewable(root, 'AGENTS.md')).toThrow(/instruction/i);
    expect(() => assertReviewable(root, '.cursor/rules/style.mdc')).toThrow(/instruction/i);
  });

  it('rejects non-markdown', () => {
    writeFileSync(join(root, 'main.ts'), 'export {};\n');
    expect(() => assertReviewable(root, 'main.ts')).toThrow(/markdown/i);
  });
});

describe('extractComments', () => {
  it('keeps a real marker and drops a broken one and one inside a fence', () => {
    const md = [
      'Intro <!-- @comment{',
      '  "id":"c1",',
      '  "anchor":"highlighted text",',
      '  "text":"Rewrite this.",',
      '  "author":"User"',
      '} -->highlighted text continues.',
      '',
      'Broken <!-- @comment{ "id":',
      '} -->still here.',
      '',
      '```md',
      'sample <!-- @comment{"id":"c2","anchor":"inside","text":"nope"} -->inside',
      '```',
    ].join('\n');
    expect(extractComments(md)).toEqual([
      { id: 'c1', anchor: 'highlighted text', text: 'Rewrite this.', author: 'User' },
    ]);
  });
});

describe('insertComment', () => {
  it('anchors the marker to the first visible occurrence and leaves a later copy alone', () => {
    const md = 'Keep this sentence. Keep this sentence.';
    const next = insertComment(md, { anchor: 'Keep this sentence.', text: 'Tighten it.', author: 'User' });
    const comments = extractComments(next);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe('Tighten it.');
    expect(next.indexOf('<!-- @comment')).toBeLessThan(next.indexOf('Keep this sentence.'));
    expect(stripForReview(next).match(/Keep this sentence\./g)).toHaveLength(2);
  });

  it('refuses an anchor that exists only inside a fenced block', () => {
    const md = ['Visible.', '```', 'fenced phrase', '```'].join('\n');
    expect(() => insertComment(md, { anchor: 'fenced phrase', text: 'x', author: 'User' })).toThrow(/anchor/);
  });

  it('does not treat the anchor stored inside a marker as a second place to comment', () => {
    const md = '<!-- @comment{"id":"c","anchor":"hidden phrase","text":"old"} -->hidden phrase';
    const next = insertComment(md, { anchor: 'hidden phrase', text: 'again', author: 'User' });
    expect(extractComments(next)).toHaveLength(2);
    expect(stripForReview(next).match(/hidden phrase/g)).toHaveLength(1);
  });
});

describe('stripForReview', () => {
  it('removes comment markers so the rendered text can be selected', () => {
    const md = 'Before <!-- @comment{"id":"c","anchor":"After","text":"n"} -->After';
    expect(stripForReview(md)).toBe('Before After');
  });
});

describe('reviewPrompt', () => {
  it('lists comments and says they are not plan approval', () => {
    const text = reviewPrompt('docs/spec.md', [
      { id: 'c1', anchor: 'highlighted text', text: 'Rewrite this.', author: 'User' },
    ]);
    expect(text).toContain('docs/spec.md');
    expect(text).toContain('Do not treat this as plan approval.');
    expect(text).toContain('"highlighted text"');
    expect(text).toContain('Rewrite this.');
  });
});
