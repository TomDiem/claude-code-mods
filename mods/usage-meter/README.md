# usage-meter

A live band above the prompt showing how much of your context, rate limits and money the session is using, and what the last turn added.

```
ctx 58% (116k/200k)  ·  5h 23% (resets 2h14m)  ·  $1.84
last turn +12k ctx, +$0.21
```

## What it shows

| Item | Meaning |
|------|---------|
| `ctx` | Context window fill: tokens the last response was answered over, against the model's window |
| `5h` / `7d` | Subscription rate limit windows and the time until each resets (Pro/Max only; absent with an API key) |
| `$` | Session cost so far, as `/cost` totals it |
| `last turn` | Context growth and cost of the last main turn, subagent spend included. Negative after a `/compact` |

A toast warns each time the context crosses 80%.

## Access

Reads the session's usage figures only. No network, no files, no model calls, no cost.

## Install

```
/plugin install usage-meter --marketplace TomDiem/claude-code-mods
```
