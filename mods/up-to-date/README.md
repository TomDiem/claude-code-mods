# up-to-date

One line above the prompt showing what needs you, from sources you opt in to.

```
review app#12 · ci app#3 · changes app#4 · +2
```

## What it shows

| Source | Items, most urgent first |
|--------|--------------------------|
| GitHub | `review`: a review is requested from you. `ci`: your open PR has failing CI (drafts last). `changes`: your open PR has changes requested |

- A PR that matches several reasons shows once, under the most urgent.
- What does not fit the terminal width collapses to `+N`.
- `~` before an item means the source is failing and the item is the last good result. A source that never worked shows `github: <reason>` (`not-connected`, `tool-error`, `parse-error` or `timeout`).
- Failing sources back off instead of retrying every minute.
- `changes` relies on GitHub's review decision, which is empty on repos without required reviews, so those PRs never show it.

## Enable sources

Every source is off by default, so a fresh install fetches and draws nothing. Turn one on in `/config`, under the plugin's settings:

| Setting | Source |
|---------|--------|
| `github` | GitHub |

Changes to a source take effect in the next session: restart Claude Code after enabling or disabling one.

Calendar, Linear and Slack are coming.

## Requirements

- GitHub: the [GitHub CLI](https://cli.github.com) (`gh`) installed and signed in (`gh auth login`).

## Access

Runs `gh api graphql` (read-only search of your PRs) every few minutes, only while the source is enabled and only in interactive sessions (not `-p` or the SDK). Results, including PR titles from private repos, are cached locally in the plugin's store under the Claude config directory so sessions share them; the line shows only `repo#number`, never titles. No model calls, no cost.

## Install

```
/plugin install up-to-date --marketplace TomDiem/claude-code-mods
```
