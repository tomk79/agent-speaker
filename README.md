# agent-speaker

## install

```bash
git clone https://github.com/tomk79/agent-speaker.git
```

## usage

```bash
filepath=/tmp/agent-cli.log
script -f -q -a "$filepath" your-agent-cli-command
```

```bash
npm run agent:speak -- "$filepath"
```

必要ならオプションを足します。

```bash
npm run agent:speak -- "$filepath" --voice Kyoko --rate 260
npm run agent:speak -- "$filepath" --from-start
```
