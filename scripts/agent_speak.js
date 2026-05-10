#!/usr/bin/env node
// Tail a terminal agent log and speak via macOS `say`.
// Default path rewrites with local Ollama; use --legacy-line-speak for plain line mode.

const fs = require('node:fs');
const { spawn } = require('node:child_process');

const {
  normalizeForSpeech,
  collapseWhitespace,
  splitForSpeech,
  appendSnapshotTail,
  processIncrementalChunk,
  isDecorativeLine,
} = require('./lib/agent_log_preprocess.js');

const { assertModelExists, rewriteTranscriptForSpeech } = require('./lib/ollama_voice_rewrite.js');

const {
  CliHelp,
  CliMissingLogPath,
  parseArgs,
} = require('./lib/agent_speak_cli.js');

const MAX_SPEAK_LENGTH = 220;
const MAX_RAW_CARRY_CHARS = 12000;

function printUsage(exitCode = 0) {
  const output = [
    'Usage:',
    '  node ./scripts/agent_speak.js <log-file> [options]',
    '',
    'Default mode needs local Ollama with the configured model (see --ollama-model).',
    'Use --legacy-line-speak for direct line-by-line speech without Ollama.',
    '',
    'Options:',
    '  --from-start              Read log from beginning',
    '  --voice <name>            say -v voice',
    '  --rate <wpm>              say -r words per minute',
    '  --poll-interval <ms>      File poll interval (default 400)',
    '  --ollama-url <url>        Ollama API base URL',
    '  --ollama-model <name>     Ollama model name',
    '  --debounce-ms <ms>        Quiet period before calling Ollama',
    '  --snapshot-max-chars <n>  Max characters sent to Ollama',
    '  --legacy-line-speak       Skip Ollama; speak cleaned lines directly',
    '',
    'Examples:',
    '  node ./scripts/agent_speak.js /tmp/agent.log',
    '  node ./scripts/agent_speak.js /tmp/agent.log --voice Kyoko --rate 260',
    '  node ./scripts/agent_speak.js /tmp/agent.log --legacy-line-speak',
  ].join('\n');

  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`${output}\n`);
  process.exit(exitCode);
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
  if (error instanceof CliHelp) {
    printUsage(0);
  }
  if (error instanceof CliMissingLogPath) {
    printUsage(1);
  }
  console.error(error instanceof Error ? error.message : String(error));
  printUsage(1);
}

const state = {
  initialized: false,
  waitingForFile: false,
  reading: false,
  inode: null,
  offset: 0,
  carry: '',
  rawCarry: '',
  lastMeaningfulLine: null,
  snapshot: '',
  snapshotEpoch: 0,
  queue: [],
  speaking: false,
  sayChild: null,
  lastSpoken: null,
  debounceTimer: null,
  rewriteAbort: null,
};

function interruptSpeech() {
  if (state.sayChild) {
    try {
      state.sayChild.kill('SIGTERM');
    } catch (_) {
      /* ignore */
    }
    state.sayChild = null;
  }
  state.speaking = false;
  state.queue = [];
}

function abortRewrite() {
  if (state.rewriteAbort) {
    try {
      state.rewriteAbort.abort();
    } catch (_) {
      /* ignore */
    }
    state.rewriteAbort = null;
  }
}

function clearDebounce() {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
}

function scheduleRewrite(epoch) {
  clearDebounce();
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void runRewriteCycle(epoch);
  }, options.debounceMs);
}

async function runRewriteCycle(epoch) {
  if (epoch !== state.snapshotEpoch) {
    return;
  }

  const transcript = state.snapshot.trim();
  if (!transcript) {
    return;
  }

  const controller = new AbortController();
  state.rewriteAbort = controller;

  let spoken = '';
  try {
    spoken = await rewriteTranscriptForSpeech({
      baseUrl: options.ollamaUrl,
      model: options.ollamaModel,
      transcript,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return;
    }
    console.error(`Ollama rewrite failed: ${error.message}`);
    process.exit(1);
  } finally {
    if (state.rewriteAbort === controller) {
      state.rewriteAbort = null;
    }
  }

  if (epoch !== state.snapshotEpoch) {
    return;
  }

  if (!spoken) {
    return;
  }

  interruptSpeech();

  for (const part of splitForSpeech(spoken, MAX_SPEAK_LENGTH)) {
    state.queue.push(part);
  }

  drainQueue();
}

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
  state.sayChild = child;

  child.once('error', (error) => {
    console.error(`Failed to run "say": ${error.message}`);
    process.exit(1);
  });

  child.once('exit', () => {
    state.sayChild = null;
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

function processLegacyChunk(text) {
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

function processVoiceRewriteChunk(chunk) {
  if (!chunk) {
    return;
  }

  interruptSpeech();
  abortRewrite();

  const step = processIncrementalChunk(state.rawCarry, state.lastMeaningfulLine, chunk);
  state.rawCarry = step.carry;
  state.lastMeaningfulLine = step.lastMeaningfulLine;
  const newLines = [...step.lines];

  if (state.rawCarry.length >= MAX_RAW_CARRY_CHARS) {
    const collapsed = collapseWhitespace(state.rawCarry);
    state.rawCarry = '';
    if (collapsed && !isDecorativeLine(collapsed) && collapsed !== state.lastMeaningfulLine) {
      newLines.push(collapsed);
      state.lastMeaningfulLine = collapsed;
    }
  }

  const snapshotBefore = state.snapshot;
  if (newLines.length > 0) {
    state.snapshot = appendSnapshotTail(state.snapshot, newLines, options.snapshotMaxChars);
  }

  if (state.snapshot !== snapshotBefore) {
    state.snapshotEpoch += 1;
    scheduleRewrite(state.snapshotEpoch);
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
      state.rawCarry = '';
      state.lastMeaningfulLine = null;
      state.snapshot = '';
      state.snapshotEpoch = 0;
      clearDebounce();
      abortRewrite();
      interruptSpeech();
      console.error('Log file rotated. Restarting from beginning.');
    }

    if (stats.size < state.offset) {
      state.offset = 0;
      state.carry = '';
      state.rawCarry = '';
      state.lastMeaningfulLine = null;
      state.snapshot = '';
      state.snapshotEpoch = 0;
      clearDebounce();
      abortRewrite();
      interruptSpeech();
      console.error('Log file truncated. Restarting from beginning.');
    }

    if (stats.size === state.offset) {
      return;
    }

    const chunk = await readSlice(options.filePath, state.offset, stats.size - 1);
    state.offset = stats.size;

    if (options.legacyLineSpeak) {
      processLegacyChunk(chunk);
      return;
    }

    processVoiceRewriteChunk(chunk);
  } catch (error) {
    console.error(`Watch error: ${error.message}`);
  } finally {
    state.reading = false;
  }
}

function shutdown() {
  clearDebounce();
  abortRewrite();
  interruptSpeech();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function bootstrap() {
  if (!options.legacyLineSpeak) {
    try {
      await assertModelExists(options.ollamaUrl, options.ollamaModel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      console.error('Install the model or pass --legacy-line-speak to skip Ollama.');
      process.exit(1);
    }
    console.error(
      `Voice rewrite via Ollama model "${options.ollamaModel}" (${options.ollamaUrl}), debounce ${options.debounceMs} ms`
    );
  }

  await pollFile();
  setInterval(() => {
    void pollFile();
  }, options.pollInterval);
}

void bootstrap();
