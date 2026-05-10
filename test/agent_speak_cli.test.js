const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  parseArgs,
  CliHelp,
  CliMissingLogPath,
} = require('../scripts/lib/agent_speak_cli.js');

test('parseArgs parses defaults', () => {
  const opts = parseArgs(['/tmp/agent.log']);
  assert.equal(opts.filePath, path.resolve('/tmp/agent.log'));
  assert.equal(opts.legacyLineSpeak, false);
  assert.match(opts.ollamaUrl, /^http:/);
});

test('parseArgs throws CliHelp', () => {
  assert.throws(() => parseArgs(['--help']), CliHelp);
});

test('parseArgs throws CliMissingLogPath', () => {
  assert.throws(() => parseArgs([]), CliMissingLogPath);
});

test('parseArgs rejects duplicate paths', () => {
  assert.throws(() => parseArgs(['/tmp/a', '/tmp/b']), /Only one log file/);
});

test('parseArgs rejects unknown option', () => {
  assert.throws(() => parseArgs(['/tmp/a', '--not-real']), /Unknown option/);
});

test('parseArgs rejects missing option value', () => {
  assert.throws(() => parseArgs(['/tmp/a', '--voice']), /Missing value/);
});
