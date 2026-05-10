#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEFAULT_POLL_INTERVAL = 400;
const MAX_SPEAK_LENGTH = 220;

function printUsage(exitCode = 0) {
  const output = [
    'Usage:',
    '  node ./scripts/agent_speak.js <log-file> [--from-start] [--voice <name>] [--rate <wpm>] [--poll-interval <ms>]',
    '',
    'Examples:',
    '  node ./scripts/agent_speak.js /tmp/agent.log',
    '  node ./scripts/agent_speak.js /tmp/agent.log --voice Kyoko --rate 260',
  ].join('\n');

  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exit(exitCode);
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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage(0);
    }

    if (arg === '--from-start') {
      options.fromStart = true;
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

    if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.filePath) {
      throw new Error('Only one log file path can be specified.');
    }

    options.filePath = path.resolve(arg);
  }

  if (!options.filePath) {
    printUsage(1);
  }

  return options;
}

function normalizeForSpeech(text) {
  return text
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0008/g, '')
    .replace(/[\u0000-\u0007\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\t+/g, ' ');
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function splitForSpeech(text, maxLength) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = '';

  for (const word of words) {
    if (!word) {
      continue;
    }

    if (word.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = '';
      }

      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function readSlice(filePath, start, end) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf8',
      start,
      end,
    });

    stream.on('data', (chunk) => {
      buffer += chunk;
    });

    stream.on('end', () => {
      resolve(buffer);
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

function statFile(filePath) {
  return fs.promises.stat(filePath).catch((error) => {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
}

if (process.platform !== 'darwin') {
  console.error('This script requires macOS because it uses the "say" command.');
  process.exit(1);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  printUsage(1);
}

const state = {
  initialized: false,
  waitingForFile: false,
  reading: false,
  inode: null,
  offset: 0,
  carry: '',
  queue: [],
  speaking: false,
  lastSpoken: null,
};

function drainQueue() {
  if (state.speaking || state.queue.length === 0) {
    return;
  }

  const text = state.queue.shift();
  const args = [];

  if (options.voice) {
    args.push('-v', options.voice);
  }

  if (options.rate) {
    args.push('-r', String(options.rate));
  }

  args.push(text);

  state.speaking = true;

  const child = spawn('say', args, { stdio: 'ignore' });

  child.once('error', (error) => {
    console.error(`Failed to run "say": ${error.message}`);
    process.exit(1);
  });

  child.once('exit', () => {
    state.speaking = false;
    drainQueue();
  });
}

function enqueueSpeech(text) {
  const cleaned = collapseWhitespace(text);
  if (!cleaned) {
    return;
  }

  if (cleaned === state.lastSpoken) {
    return;
  }

  for (const chunk of splitForSpeech(cleaned, MAX_SPEAK_LENGTH)) {
    state.queue.push(chunk);
  }

  state.lastSpoken = cleaned;
  drainQueue();
}

function processChunk(text) {
  const normalized = normalizeForSpeech(state.carry + text);
  const lines = normalized.split('\n');
  state.carry = lines.pop() || '';

  for (const line of lines) {
    enqueueSpeech(line);
  }

  if (state.carry.length >= MAX_SPEAK_LENGTH) {
    enqueueSpeech(state.carry);
    state.carry = '';
  }
}

async function pollFile() {
  if (state.reading) {
    return;
  }

  state.reading = true;

  try {
    const stats = await statFile(options.filePath);

    if (!stats) {
      if (!state.waitingForFile) {
        console.error(`Waiting for log file: ${options.filePath}`);
        state.waitingForFile = true;
      }
      return;
    }

    if (state.waitingForFile) {
      state.waitingForFile = false;
    }

    if (!state.initialized) {
      state.initialized = true;
      state.inode = typeof stats.ino === 'number' ? stats.ino : null;
      state.offset = options.fromStart ? 0 : stats.size;
      console.error(
        `Watching ${options.filePath} (${options.fromStart ? 'from start' : 'new content only'})`
      );

      if (!options.fromStart) {
        return;
      }
    }

    if (state.inode !== null && typeof stats.ino === 'number' && stats.ino !== state.inode) {
      state.inode = stats.ino;
      state.offset = 0;
      state.carry = '';
      console.error('Log file rotated. Restarting from beginning.');
    }

    if (stats.size < state.offset) {
      state.offset = 0;
      state.carry = '';
      console.error('Log file truncated. Restarting from beginning.');
    }

    if (stats.size === state.offset) {
      return;
    }

    const chunk = await readSlice(options.filePath, state.offset, stats.size - 1);
    state.offset = stats.size;
    processChunk(chunk);
  } catch (error) {
    console.error(`Watch error: ${error.message}`);
  } finally {
    state.reading = false;
  }
}

process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

void pollFile();
setInterval(() => {
  void pollFile();
}, options.pollInterval);