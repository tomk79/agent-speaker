const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  normalizeForSpeech,
  refineMeaningfulLines,
  appendSnapshotTail,
  truncateSnapshotForLlm,
  processIncrementalChunk,
  collapseWhitespace,
} = require('../scripts/lib/agent_log_preprocess.js');

test('normalizeForSpeech strips ANSI and OSC sequences', () => {
  const raw =
    '\x1b]1337;RemoteHost=user@host\x07\x1b[33mHello\x1b[0m \x1b[1mworld\x1b[22m';
  assert.equal(normalizeForSpeech(raw), 'Hello world');
});

test('refineMeaningfulLines removes frame-heavy lines but keeps prose', () => {
  const lines = [
    '  ╭────────────────────╮  ',
    '  │  ⚠ Workspace Trust │  ',
    'Do you trust this directory?',
    '  ╰────────────────────╯  ',
    'Cursor Agent',
    '  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  ',
    'Do you trust this directory?',
  ];
  const refined = refineMeaningfulLines(lines);
  assert.ok(refined.some((l) => l.includes('Workspace Trust')));
  assert.ok(refined.some((l) => l.includes('Do you trust')));
  assert.ok(refined.some((l) => l.includes('Cursor Agent')));
  assert.equal(refined.filter((l) => l.includes('▀')).length, 0);
});

test('appendSnapshotTail preserves tail when over limit', () => {
  const tail = 'END_MARKER';
  const big = `${'x'.repeat(100)}\n${tail}`;
  const snapshot = appendSnapshotTail('', big, 30);
  assert.ok(snapshot.endsWith(tail));
  assert.ok(snapshot.length <= 30);
});

test('truncateSnapshotForLlm keeps last N lines', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
  const text = lines.join('\n');
  const out = truncateSnapshotForLlm(text, 40, 1_000_000);
  assert.equal(out.split('\n').length, 40);
  assert.ok(out.startsWith('L10'));
  assert.ok(out.endsWith('L49'));
});

test('truncateSnapshotForLlm caps by characters from tail', () => {
  const text = `${'a'.repeat(100)}\nKEEP_TAIL`;
  const out = truncateSnapshotForLlm(text, 100, 12);
  assert.ok(out.endsWith('KEEP_TAIL'));
  assert.ok(out.length <= 12);
});

test('processIncrementalChunk dedupes repeats across redraws', () => {
  let carry = '';
  let last = null;
  const acc = [];
  const chunks = ['Line A\n', 'Line A\n', 'Line B\n'];
  for (const c of chunks) {
    const step = processIncrementalChunk(carry, last, c);
    carry = step.carry;
    last = step.lastMeaningfulLine;
    acc.push(...step.lines);
  }
  assert.deepEqual(acc, ['Line A', 'Line B']);
});

test('fixture snippet yields digestible lines without ANSI', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'cursor-agent-snippet.log');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const normalized = normalizeForSpeech(raw);
  assert.ok(!normalized.includes('\x1b'));
  const lines = normalized.split('\n').map((l) => collapseWhitespace(l)).filter(Boolean);
  const refined = refineMeaningfulLines(lines);
  assert.ok(refined.length > 5);
  assert.ok(refined.some((l) => l.includes('Workspace Trust')));
});
