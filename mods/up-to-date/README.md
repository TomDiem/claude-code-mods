# up-to-date

One line above the prompt showing what needs you, from sources you opt in to.

```
🔀 app#12 review requested +2
```

One segment per source, led by its icon and showing its most urgent item, with `+N` for the rest. Segments are colored by urgency with your theme's `warning` and `error` colors: warning for a review request, error for failing CI.

## Details

Open a pane with everything behind the line, grouped by reason:

```
┌──────────────────────────────────────────────┐
│ 🔀 Review requested                           │
│   claude-code-mods#4 One segment per source   │
│ 🔀 CI failing                                 │
│   claude-code-mods#5 Calendar adapter         │
└──────────────────────────────────────────────┘
```

- **Keyboard (any layout):** `ctrl+x` `tab` focuses the line, then `Enter` opens the pane.
- **Mouse:** click the line. Claude Code only reports clicks in the fullscreen layout (`"tui": "fullscreen"` in `settings.json`), so in the default layout use the keyboard.
- **Esc** closes the pane.

Each `repo#number` is a link to the PR, followed by its title (dim) and `(draft)` for a draft. The links are OSC 8 hyperlinks: open one with your terminal's link gesture (`ctrl+click` in Windows Terminal). A source that is failing since a good fetch says `last updated N min ago`; one that never worked says why; with nothing to list the pane says `Nothing needs you.`. The pane reads what is already fetched, so opening it never calls `gh`.

## What it shows

| Source | Icon | Most urgent item, in order |
|--------|------|----------------------------|
| GitHub | 🔀 | `review requested`: a review is requested from you (warning). `CI failing`: your open PR has failing CI, drafts last (error). `changes requested`: your open PR has changes requested |
| Calendar | 📅 | `in 12m: Standup`: a meeting starts within 15 minutes (warning). `now: Standup`: a meeting is in progress (suggestion). Otherwise the next one by clock time, `14:30 Standup` |

- A PR that matches several reasons counts once, under the most urgent.
- On a narrow terminal the least urgent source shortens fully first (`🔀 #12 review +2`, then `🔀 3 PRs`), then the next one up. Only when every source is at its shortest does the least urgent get dropped, shown as ` · +N` for the N dropped.
- `~` before a segment (drawn dim) means the source is failing and the segment is the last good result. A source that never worked shows `🔀 github: <reason>` dim, or `🔀 !` when there is no room (`not-connected`, `tool-error`, `parse-error` or `timeout`).
- Failing sources back off instead of retrying every minute.
- Calendar shows the next 7 days of your calendar. It leaves out cancelled events, ones you declined, all-day events, free (not busy) events, ones that already ended, and ones longer than `calendarMaxBlockHours` (3 by default), which are usually focus blocks. The countdown updates every minute without calling the connector again; a meeting further out than today shows its weekday (`Wed 09:00 Planning`).
- `changes` relies on GitHub's review decision, which is empty on repos without required reviews, so those PRs never show it.

## Enable sources

Every source is off by default, so a fresh install fetches and draws nothing. Turn one on with `/plugin configure up-to-date@tomdiem-mods`:

| Setting | Source |
|---------|--------|
| `github` | GitHub |
| `calendar` | Calendar |
| `calendarMaxBlockHours` | Longest event Calendar counts as a meeting (hours, default 3) |

Changes to a source take effect in the next session: restart Claude Code after enabling or disabling one.

Linear and Slack are coming.

## Requirements

- Calendar: the Google Calendar connector connected in claude.ai (`/mcp` lists it as `claude.ai Google Calendar`).
- GitHub: the [GitHub CLI](https://cli.github.com) (`gh`) installed and signed in (`gh auth login`).

## Access

Calendar calls the `list_events` tool of your `claude.ai Google Calendar` connector (read-only) every 5 minutes, or every 2 minutes while a meeting is in progress or starts within 30 minutes, so a moved event is picked up quickly. Event titles are cached locally like PR titles and appear in the line and the pane.

GitHub runs `gh api graphql` (read-only search of your PRs) every few minutes, only while the source is enabled and only in interactive sessions (not `-p` or the SDK). Results, including PR titles from private repos, are cached locally in the plugin's store under the Claude config directory so sessions share them; the line shows only `repo#number`; titles appear only in the details pane. No model calls, no cost.

## Install

```
/plugin install up-to-date --marketplace TomDiem/claude-code-mods
```
