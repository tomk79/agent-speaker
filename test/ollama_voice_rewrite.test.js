const test = require('node:test');
const assert = require('node:assert/strict');

const { assertModelExists, rewriteTranscriptForSpeech } = require('../scripts/lib/ollama_voice_rewrite.js');

test('assertModelExists rejects when model missing', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ models: [{ name: 'llama3:latest' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  await assert.rejects(
    () => assertModelExists('http://127.0.0.1:11434', 'gemma4:e4b', fetchImpl),
    /gemma4:e4b/
  );
});

test('rewriteTranscriptForSpeech posts chat payload', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gemma4:e4b');
    assert.equal(body.stream, false);
    assert.ok(Array.isArray(body.messages));
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[1].content, /ログ/);

    return new Response(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: 'エージェントが説明を続けています。',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const text = await rewriteTranscriptForSpeech({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'gemma4:e4b',
    transcript: 'hello world',
    signal: undefined,
    fetchImpl,
    logToStdout: false,
    timeoutMs: 180000,
  });

  assert.equal(text, 'エージェントが説明を続けています。');
});

test('rewriteTranscriptForSpeech rejects when chat hangs past timeout', async () => {
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        'abort',
        () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true }
      );
    });

  await assert.rejects(
    () =>
      rewriteTranscriptForSpeech({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'gemma4:e4b',
        transcript: 'hello world',
        signal: undefined,
        fetchImpl,
        logToStdout: false,
        timeoutMs: 25,
      }),
    /timed out after 25 ms/
  );
});

test('rewriteTranscriptForSpeech rejects when response body never completes', async () => {
  const fetchImpl = async (url, init) => ({
    ok: true,
    async json() {
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          },
          { once: true }
        );
      });
    },
  });

  await assert.rejects(
    () =>
      rewriteTranscriptForSpeech({
        baseUrl: 'http://127.0.0.1:11434',
        model: 'gemma4:e4b',
        transcript: 'hello world',
        signal: undefined,
        fetchImpl,
        logToStdout: false,
        timeoutMs: 25,
      }),
    /timed out after 25 ms/
  );
});
