const { collapseWhitespace } = require('./agent_log_preprocess.js');

function mergeAbortSignalWithTimeout(parentSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  let timerId = null;

  const cleanup = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (parentSignal) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
  };

  const onParentAbort = () => {
    cleanup();
    controller.abort();
  };

  const onTimer = () => {
    timedOut = true;
    cleanup();
    controller.abort();
  };

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive finite number.');
  }

  if (parentSignal?.aborted) {
    controller.abort();
    return {
      signal: controller.signal,
      dispose: () => {},
      getDidTimeout: () => false,
    };
  }

  timerId = setTimeout(onTimer, timeoutMs);
  if (parentSignal) {
    parentSignal.addEventListener('abort', onParentAbort);
  }

  return {
    signal: controller.signal,
    dispose: cleanup,
    getDidTimeout: () => timedOut,
  };
}

const SYSTEM_PROMPT = `あなたはターミナル上のコーディングエージェントのログを、音声読み上げ用に整える編集者です。
次のルールを守ってください。
- 出力は日本語のみ、聞き取りやすい短い段落にする。
- 装飾記号やメニューの一覧は省き、ユーザーやエージェントの確定したメッセージ・結果・次のアクションだけを伝える。
- ソースコードや設定の全文は読み上げず、何をどうしたかを平易に言い換える。
- ファイルパスやURLは、必要なときだけ概要として触れ、文字列を一字一句読まない。
- 入力途中と思われる断片や重複は無視する。
- ログに書かれていない推測や付け足しはしない。`;

async function listOllamaModels(baseUrl, fetchImpl = global.fetch) {
  const response = await fetchImpl(new URL('/api/tags', baseUrl), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama /api/tags HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function assertModelExists(baseUrl, modelName, fetchImpl = global.fetch) {
  let data;
  try {
    data = await listOllamaModels(baseUrl, fetchImpl);
  } catch (error) {
    const hint = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach Ollama at ${baseUrl} (${hint}). Start Ollama or pass --ollama-url.`
    );
  }

  const models = Array.isArray(data.models) ? data.models : [];
  const names = models.map((entry) => entry.name).filter(Boolean);
  if (names.includes(modelName)) {
    return;
  }

  const sample = names.slice(0, 12).join(', ');
  throw new Error(
    `Ollama model "${modelName}" is not available locally (ollama list). ` +
      `Install it (for example: ollama pull ${modelName}). ` +
      `Currently listed (may be partial): ${sample || '(none)'}`
  );
}

async function rewriteTranscriptForSpeech({
  baseUrl,
  model,
  transcript,
  signal,
  fetchImpl = global.fetch,
  logToStdout = false,
  timeoutMs,
}) {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return '';
  }

  const url = new URL('/api/chat', baseUrl);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        '以下はターミナルログから抽出したテキストです。音声読み上げに適した日本語だけを返してください（説明や前置きは不要）。\n\n' +
        trimmed,
    },
  ];
  const payload = {
    model,
    stream: false,
    messages,
  };

  if (logToStdout) {
    console.log('=== Ollama chat: system message ===');
    console.log(messages[0].content);
    console.log('=== Ollama chat: user message ===');
    console.log(messages[1].content);
    console.log('/ === Ollama chat: prompt end ===');
    console.log('/ --------------------------------------' + "\n\n\n");
    console.error(
      `[agent-speak] Ollama の応答を待っています（モデル: ${model}, タイムアウト ${timeoutMs} ms）。stdout はこの後、応答が返るまで更新されません。`
    );
  }

  const merged = mergeAbortSignalWithTimeout(signal, timeoutMs);
  let data;
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: merged.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama /api/chat HTTP ${response.status}: ${body.slice(0, 240)}`);
    }

    data = await response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      if (merged.getDidTimeout()) {
        throw new Error(`Ollama /api/chat timed out after ${timeoutMs} ms`);
      }
      throw error;
    }
    throw error;
  } finally {
    merged.dispose();
  }

  const raw =
    (data.message && typeof data.message.content === 'string' && data.message.content) ||
    (typeof data.response === 'string' && data.response) ||
    '';

  const speechText = collapseWhitespace(raw);
  if (logToStdout) {
    if (speechText) {
      console.log('=== Ollama chat: assistant speech text ===');
      console.log(speechText);
      console.log('/ === Ollama chat: assistant speech text end ===');
      console.log('/ --------------------------------------' + "\n\n\n");
    } else {
      console.error(
        '[agent-speak] Ollama の応答に読み上げ用の本文がありません（空または想定外の JSON）。読み上げはスキップされます。'
      );
    }
  }

  return speechText;
}

module.exports = {
  SYSTEM_PROMPT,
  listOllamaModels,
  assertModelExists,
  rewriteTranscriptForSpeech,
};
