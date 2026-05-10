const path = require('node:path');

const DEFAULT_POLL_INTERVAL = 400;
const DEFAULT_DEBOUNCE_MS = 20000;
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'gpt-oss:20b';
const DEFAULT_SNAPSHOT_MAX_CHARS = 48000;

class CliHelp extends Error {
  constructor() {
    super('CLI_HELP');
    this.name = 'CliHelp';
  }
}

class CliMissingLogPath extends Error {
  constructor() {
    super('CLI_MISSING_LOG_PATH');
    this.name = 'CliMissingLogPath';
  }
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function readPositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    filePath: null,
    fromStart: false,
    voice: null,
    rate: null,
    pollInterval: DEFAULT_POLL_INTERVAL,
    ollamaUrl: DEFAULT_OLLAMA_URL,
    ollamaModel: DEFAULT_OLLAMA_MODEL,
    debounceMs: DEFAULT_DEBOUNCE_MS,
    snapshotMaxChars: DEFAULT_SNAPSHOT_MAX_CHARS,
    legacyLineSpeak: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      throw new CliHelp();
    }

    if (arg === '--from-start') {
      options.fromStart = true;
      continue;
    }

    if (arg === '--legacy-line-speak') {
      options.legacyLineSpeak = true;
      continue;
    }

    if (arg === '--voice') {
      options.voice = readOptionValue(argv, index, '--voice');
      index += 1;
      continue;
    }

    if (arg === '--rate') {
      const value = readOptionValue(argv, index, '--rate');
      options.rate = readPositiveInteger(value, '--rate');
      index += 1;
      continue;
    }

    if (arg === '--poll-interval') {
      const value = readOptionValue(argv, index, '--poll-interval');
      options.pollInterval = readPositiveInteger(value, '--poll-interval');
      index += 1;
      continue;
    }

    if (arg === '--ollama-url') {
      options.ollamaUrl = readOptionValue(argv, index, '--ollama-url');
      index += 1;
      continue;
    }

    if (arg === '--ollama-model') {
      options.ollamaModel = readOptionValue(argv, index, '--ollama-model');
      index += 1;
      continue;
    }

    if (arg === '--debounce-ms') {
      const value = readOptionValue(argv, index, '--debounce-ms');
      options.debounceMs = readPositiveInteger(value, '--debounce-ms');
      index += 1;
      continue;
    }

    if (arg === '--snapshot-max-chars') {
      const value = readOptionValue(argv, index, '--snapshot-max-chars');
      options.snapshotMaxChars = readPositiveInteger(value, '--snapshot-max-chars');
      index += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.filePath) {
      throw new Error('Only one log file path can be specified.');
    }

    options.filePath = path.resolve(arg);
  }

  if (!options.filePath) {
    throw new CliMissingLogPath();
  }

  return options;
}

module.exports = {
  DEFAULT_POLL_INTERVAL,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_SNAPSHOT_MAX_CHARS,
  CliHelp,
  CliMissingLogPath,
  readOptionValue,
  readPositiveInteger,
  parseArgs,
};
