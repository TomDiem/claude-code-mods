# claude-mods

Mods for [Claude Code](https://code.claude.com): small plugins that change what Claude Code shows and how it behaves. Each mod is independent, so you install only the ones you want.

## Mods

| Mod | What it does |
|-----|--------------|
| [usage-meter](mods/usage-meter) | Live context, rate limit and cost meter above the prompt, plus what the last turn added |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-meter --marketplace TomDiem/claude-mods
```

From a shell:

```bash
claude plugin install usage-meter --marketplace TomDiem/claude-mods
```

Built and tested on Claude Code 2.1.310.

## Develop

```bash
claude --plugin-dir ./mods/usage-meter   # load from disk, reloads on save
claude plugin validate mods/usage-meter  # what the engine would accept or refuse
claude plugin test mods/usage-meter      # run the mod's *.test.ts files
```

## License

[MIT](LICENSE)
