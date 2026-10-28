**English** · [简体中文](./README.zh-CN.md)

# pi-nerdfont-unescape

Nerd Font icons in the Pi TUI: **escapes in, glyphs out, nothing lost silently.**

Model channels drop Private Use Area codepoints — exactly where Nerd Font icons
live. A model writes an icon, you see a blank, and nothing tells you anything was
missing. This extension attacks that from both ends:

- **The model writes ASCII.** The system prompt asks for escapes (`\uE235`,
  `\u{f0805}`), which survive any tokenizer; the extension restores them to real
  glyphs as the message lands.
- **Code stays literal.** Escapes inside fences, blockquoted fences and inline
  spans are never touched, so config snippets stay copy-paste safe.
- **Nothing disappears quietly.** A character with no renderable glyph becomes a
  visible `□U+FDD0` marker instead of a blank.

## Install

```bash
pi install npm:pi-nerdfont-unescape
```

No runtime dependencies: `typebox` is a *peer* dependency because pi already
provides it (a regular dependency would install a second copy and make pi warn at
startup). Nothing to configure on Linux with fontconfig. Glyph ground truth, the
`nerdfont_lookup` tool and the `render_preview` tool use `python3` with
[fontTools](https://fonttools.readthedocs.io/); without it the extension still
runs, judges what it can, and says what it could not check — never silently.

> Not on npm yet. Until the first release: `pi install /path/to/pi-nerdfont-unescape`.

## What you get

| | |
|---|---|
| **Escape restoration** | `\uXXXX` / `\u{xxxxx}` → real glyph, outside code |
| **Code protection** | fenced blocks (including fences quoted inside a blockquote) and inline spans, with CommonMark equal-length delimiters — double-backtick wrapping included |
| **Visible substitution** | noncharacters, Tags, unassigned BMP, and any codepoint missing from the active font chain — or whenever that chain cannot be identified — render as `□U+XXXX` |
| **Input escaping** | at-risk characters in *your* message are escaped before sending, so the model receives what you typed |
| **Drop detection** | codepoints seen in the stream but missing from the final message are reported with their codepoints |
| **`[[nf:name]]` markers** *(beta)* | write a semantic name; it is resolved against the fonts you actually have, and unknown names are warned about, never invented |
| **`nerdfont_lookup`** | query installed glyphs by keyword or codepoint, family-prioritized, starship defaults included |
| **`render_preview`** | monospace-grid renderer with terminal width arithmetic (CJK/emoji = 2 columns, private use = 1) |

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `PI_NF_FONT_PATHS` | unset — fontconfig's ordered `monospace` chain is used | Explicit font files or directories (platform path separator). Needed on macOS/Windows, or when your terminal font is not fontconfig's `monospace` |
| `PI_NF_CMAP_CACHE` | `~/.cache/pi-nerdfont-unescape/cmap.json` (macOS: `~/Library/Caches/…`, Windows: `%LOCALAPPDATA%\…`) | Where the glyph cache lives; safe to delete, it is rebuilt on the next session |
| `PI_RENDER_ALLOW_ANY` | unset | Lets `render_preview` write outside the working directory and `/tmp` |

## Limits

Deliberate, and stated so you can decide for yourself.

| Limit | Why |
|---|---|
| **The transcript stores restored characters** | `message_end` feeds display *and* storage; the extension API has no paint-time-only hook. Consequence: the model sees real glyphs in its own history — if it copies one instead of writing the escape, the channel can still drop it. |
| **A dropped raw character is undetectable** | If the channel removes a character before the message reaches the extension and the text carries no codepoint hint, no signal remains. Empty quote pairs are never guessed at: `""` and “one character vanished” are bit-identical. |
| **Four-space indented blocks are not treated as code** | Indistinguishable from list continuation; guessing wrong would silently disable restoration. |
| **`[[nf:]]` resolution depends on your fonts** | Names resolve against the fonts actually installed. A missing name is reported, never approximated. |
| **Only assistant messages are transformed** | User messages are escaped on the way out (see above); transforming them again on the way in would double-process them. |

## Development

```bash
npm test                  # 112 assertions, no model calls, ~20 s
npm run test:audit        # 86 mutations: proves every assertion can fail
scripts/tui-probe/run.sh  # the real TUI with a fixed message, no model calls
npm run tui:pixel         # that same screen, captured as a PNG
```

- **Tests build their own font fixtures**, so results never depend on the fonts
  installed on your machine; a missing `python3` fails the suite loudly instead
  of skipping.
- **Every suite runs under a cgroup ceiling** (`scripts/safe-run.sh`: 2 GB memory
  cap, refuses to start when the machine is short on memory). Parallel audits have
  taken down a desktop before; the audit defaults to one worker and takes
  `--jobs N` when you want more.
- **The mutation audit resumes.** Verdicts are journaled to
  `/tmp/pi-mutation-journal-<source-hash>.json`; any source edit invalidates the
  journal, so a resumed run can never report a stale green.

```bash
npm run test:audit -- --only "M6[0-9]" --jobs 4   # targeted slice
npm run test:audit -- --fresh                     # ignore the journal
npm run test:audit -- --list                      # names only
```

The TUI probes drive the real interface with a canned message through a local
OpenAI-compatible server, so no model is involved and nothing depends on a
network. `scripts/tui-probe/run.sh` reads the rendered screen from tmux;
`scripts/tui-probe/pixel.sh` captures pixels from a virtual X display (Xvfb) —
the only way to verify that glyphs actually **paint**, not merely that the right
codepoints are present. Two traps worth knowing if you extend them: never redirect
stdout inside the tmux command (pi degrades to plain text without a TTY), and
unset `WAYLAND_DISPLAY` before starting the terminal on the virtual display.

`DROP_PUA=1 scripts/tui-probe/run.sh scripts/tui-probe/message-drop.txt`
reproduces the original defect: the fake channel removes private-use characters
from its output, so you can see all three outcomes in one frame — a protocol
escape restored, a raw character gone without a trace, and a codepoint hint
(`-- U+E0B0`) turned into a visible `□`.

## Design notes

- **Escapes, not raw glyphs.** Tokenizers do not know private-use codepoints, so
  an icon written as a character is a coin flip. ASCII escapes are not.
- **Nothing is guessed.** When the font state is unknown, the extension shows
  `□U+XXXX` rather than picking a plausible glyph; when a signal is absent, it
  stays silent rather than inventing a warning.
- **The channel cannot be repaired from here.** This runs after the bytes arrive.
  It rebuilds what the model encoded, and makes visible what it cannot rebuild.

## License

MIT — keep the copyright and license notice when you use it.
