# agent-speaker

## install

```bash
git clone https://github.com/tomk79/agent-speaker.git
```

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

```bash
npm run agent:speak -- "$filepath"
```

必要ならオプションを足します。

```bash
npm run agent:speak -- "$filepath" --voice Kyoko --rate 260
npm run agent:speak -- "$filepath" --from-start
```
