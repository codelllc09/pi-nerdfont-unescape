**English** · [简体中文](./README.zh-CN.md)

# pi-nerdfont-unescape

An extension for pi that keeps Nerd Font icons intact in model replies.

Some models lose those icons while answering. A Nerd Font icon is a Unicode
private-use character, and the model's output stream silently drops it: you ask
for a Python icon and the place where it should be is empty — no error, nothing to
notice. This extension asks the model to spell icons as plain text instead
(`\uE235`), then turns them back into icons before the reply reaches you.

## Where it stops

This does not remove silent loss; it removes most of it and makes the rest
visible. Precisely:

| It does | It cannot |
|---|---|
| Icons the model writes as escapes (`\uE235`) survive and render | An icon the model writes as a raw character, dropped by the output stream *before* the message arrives, leaves no trace to detect |
| A codepoint with no usable glyph becomes a visible `□U+XXXX` | If your terminal renders with a font outside the detected chain, a glyph can still come out as tofu — the check trusts the font it can read |
| A drop visible *within* the stream is reported with codepoints | A drop that already happened upstream carries no signal |
| Code blocks are never rewritten | — |
| Your own message is escaped before sending | — |

Short version: it fixes the loss it can see, and it says what it cannot see. It
does not repair the model's output stream.

## Install

```bash
pi install npm:pi-nerdfont-unescape
```

Restart pi. That is all: on Linux with fontconfig it works out of the box.

Optionally install `python3` with [fontTools](https://fonttools.readthedocs.io/)
to enable glyph lookup and layout rendering (`pip install fonttools`). Without it
the extension still works; it just tells you which lookups it could not perform.

> Not on npm yet. Until the first release: `pi install /path/to/pi-nerdfont-unescape`.

The package has no runtime dependencies — `typebox` is declared as a *peer* because
pi already provides it.

## What changes in your day

| | |
|---|---|
| **Ask for an icon by name** | `[[nf:python]]` becomes the real glyph when the message lands *(beta: resolved against the fonts you have)* |
| **Paste an icon yourself** | at-risk characters are escaped on the way out, so the model receives what you typed instead of a hole |
| **Copy config snippets** | escapes inside code blocks and inline code are never touched — what you copy is what was written |
| **See what is missing** | a character the extension can tell is undrawable shows as `□U+E5EE` instead of a blank |

## Using it

| You want | Say something like |
|---|---|
| An icon in a list or heading | “use `[[nf:python]]` for the Python item” |
| The right codepoint for a glyph | “look up the docker icon” · “what is U+E0A0?” → `nerdfont_lookup` |
| An aligned table, status bar or poster | “render this as a boxed table” → `render_preview` |
| Starship's default symbol for a module | “starship nodejs symbol” → `nerdfont_lookup` |

Both tools read your **installed fonts**, so results match what your terminal can
actually draw. The extension never guesses a codepoint.

## If something looks wrong

| What you see | Why | What to do |
|---|---|---|
| `□U+E5EE` in a message | that codepoint has no glyph in your terminal's font chain — or your font chain could not be identified | install a Nerd Font and set it as the terminal font; the marker names the exact codepoint |
| An icon is missing entirely | the model wrote the raw character instead of an escape, and the output stream dropped it before anything could see it | ask for the escape form (`\uE235`) or the `[[nf:name]]` marker |
| `could not be resolved — font lookup unavailable` | `python3` (or fontTools) is missing | `pip install fonttools`, or ignore it: everything else still works |
| `\uE235` visible in a fenced block | intended: code stays literal so it can be copied | nothing to fix |

## Settings (all optional)

| Variable | Default | When you need it |
|---|---|---|
| `PI_NF_FONT_PATHS` | fontconfig's `monospace` chain | macOS, Windows, or a terminal font that is not fontconfig's `monospace`: point at the font files/directories (platform path separator) |
| `PI_NF_CMAP_CACHE` | `~/.cache/pi-nerdfont-unescape/cmap.json` | to move the glyph cache; safe to delete, it is rebuilt next session |
| `PI_RENDER_ALLOW_ANY` | unset | to let `render_preview` write outside the working directory and `/tmp` |

## Known limits

- **`[[nf:name]]` is beta.** Names resolve against the fonts installed on your
  machine; nothing else is consulted.
- **Four-space indented blocks are not treated as code** — they cannot be told
  apart from list continuations, and guessing wrong would silently break
  restoration elsewhere.
- **The transcript stores the restored characters** (that is what you saw, and
  what reloads). If the model later copies one instead of writing the escape, it
  can still be dropped.
## Development

Tests, the mutation audit, and the model-free TUI probes are documented in
[DEVELOPMENT.md](./DEVELOPMENT.md).

## License

MIT — keep the copyright and license notice when you use it.
