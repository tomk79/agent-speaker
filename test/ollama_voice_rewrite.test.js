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
    () => assertModelExists('http://127.0.0.1:11434', 'gpt-oss:20b', fetchImpl),
    /gpt-oss:20b/
  );
});

test('rewriteTranscriptForSpeech posts chat payload', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:11434/api/chat');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-oss:20b');
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
    model: 'gpt-oss:20b',
    transcript: 'hello world',
    signal: undefined,
    fetchImpl,
    logToStdout: false,
  });

  assert.equal(text, 'エージェントが説明を続けています。');
});
