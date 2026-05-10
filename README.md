# agent-speaker

## install

```bash
git clone https://github.com/tomk79/agent-speaker.git
```

## 前提

- **macOS**（`say` を使用）
- **Node.js 18 以上**（組み込み `fetch` を利用）
- **既定モード**: [Ollama](https://ollama.com/) が起動しており、モデル **`gpt-oss:20b`** が利用できること（例: `ollama pull gpt-oss:20b`）。別モデルを使う場合は `--ollama-model` で指定する。
- **従来モード**: Ollama が不要。`--legacy-line-speak` でログ行を正規化したうえでそのまま読み上げる。

## 想定するエージェント CLI

説明・サンプルは次のターミナル向けコーディングエージェントを前提とします（ログが標準出力・標準エラーに出れば同様に利用できますが、ドキュメント上の想定対象は次の4製品です）。

| 製品 | 起動コマンドの例 |
|---|---|
| Cursor CLI | `agent` |
| Claude Code | `claude` |
| Codex | `codex` |
| GitHub Copilot CLI | `copilot` |

Cursor CLI は環境によって `cursor-agent` など別のコマンド名になることがあります。インストール方法により実行ファイル名やパスが異なる場合があります。実際の起動方法は各製品の公式ドキュメントに従ってください。

[`sample/cursor-agent.log`](sample/cursor-agent.log) は Cursor CLI セッションから取得したログの一例です。

## usage

ターミナル A でエージェントを `script` で包みログへ追記し、ターミナル B で読み上げを起動します。

```bash
filepath=/tmp/agent-cli.log
script -f -q -a "$filepath" agent    # Cursor CLI の例
```

```bash
script -f -q -a "$filepath" claude   # Claude Code の例
```

```bash
script -f -q -a "$filepath" codex    # Codex の例
```

```bash
script -f -q -a "$filepath" copilot # GitHub Copilot CLI の例
```

### 既定（Ollama で音声向けに整形）

ログを軽くクリーンアップしてスナップショット化し、しばらく追記が止まってからローカル Ollama で要約・整形したテキストを読み上げます。追記があると進行中の発話とリクエストは中断され、最新状態に合わせてやり直します。各 Ollama 呼び出しでは、送る system / user メッセージとモデルが返した読み上げ用テキストが**標準出力**に書き出されます。

```bash
npm run agent:speak -- "$filepath"
```

### 従来モード（行単位のまま読み上げ）

```bash
npm run agent:speak -- "$filepath" --legacy-line-speak
```

### よく使うオプション

| オプション | 説明 |
|---|---|
| `--voice <name>` | `say -v` に渡す音声名 |
| `--rate <wpm>` | `say -r` の話速 |
| `--from-start` | ログを先頭から処理 |
| `--poll-interval <ms>` | ファイル監視の間隔（既定 400） |
| `--ollama-url <url>` | Ollama のベース URL（既定 `http://127.0.0.1:11434`） |
| `--ollama-model <name>` | モデル名（既定 `gpt-oss:20b`） |
| `--debounce-ms <ms>` | 追記が止まってから Ollama を呼ぶまでの待ち（既定 20000） |
| `--snapshot-max-chars <n>` | Ollama に渡すテキスト長の上限（既定 48000） |

```bash
npm run agent:speak -- "$filepath" --voice Kyoko --rate 260
npm run agent:speak -- "$filepath" --from-start --debounce-ms 800
```

## テスト

```bash
npm test
```

## セキュリティの注意

既定モードではログのスナップショットが **ローカルの Ollama** に送られます。`--ollama-url` を変更した場合は、その先へログが送信されます。機密データを含む場合は実行環境とモデルの取り扱いを確認してください。標準出力にはプロンプトと応答も出るため、ターミナルを共有したりログをリダイレクトする際は取り扱いに注意してください。
