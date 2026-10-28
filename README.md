**English** · [简体中文](./docs/README.zh-CN.md)

# pi-nerdfont-unescape

Keeps Nerd Font icons in pi's replies.

Nerd Font icons are Unicode private-use characters, and a model's output stream
silently swallows them: you ask for a Python icon, and the place where it should
be comes back empty — no error, no warning. This extension gets the model to write
icons as ordinary text (`\uE235`) instead, and turns them back into icons when the
reply arrives.

## Limits

It does not eliminate silent loss. It blocks most of it and makes the rest visible.

| It does | It cannot |
|---|---|
| The model writes `\uE235` → the icon survives and renders | The model writes a raw character and the stream deletes it before the message arrives — nothing is left to check |
| Characters that cannot be drawn show as `□U+XXXX` | If your terminal renders with a font the extension could not read, you can still get tofu — it trusts the fonts it can read |
| Drops the extension itself sees (in the stream, missing from the final message) are reported with codepoints | A drop earlier than that leaves no signal |
| Code blocks are left untouched | — |
| Your own message is escaped before it is sent | — |

In one line: it fixes the loss it can see and says what it cannot see. The model's
output stream is not something it can repair.

Three more:

- `[[nf:name]]` is beta — names resolve only against installed fonts.
- Four-space indented blocks are not treated as code; they cannot be told apart
  from list continuations, and a wrong guess would silently break restoration
  elsewhere.
- The transcript stores the restored characters (that is what you saw). If the
  model later copies one instead of writing the escape, it can still be dropped.

## Install

```bash
pi install npm:pi-nerdfont-unescape
```

Restart pi. On Linux with fontconfig that is all it takes.

Glyph lookup and layout rendering additionally want `python3` with
[fontTools](https://fonttools.readthedocs.io/) (`pip install fonttools`). Without
them the extension still works and names the lookups it could not run.

No runtime dependencies — `typebox` is declared as a *peer* because pi provides it.

## What changes for you

| | |
|---|---|
| Icons by name | write `[[nf:python]]`; it becomes a real icon when the reply lands *(beta: installed fonts only)* |
| Icons you paste | escaped before sending, so the model receives what you typed instead of a blank |
| Config snippets you copy | escapes inside code blocks and inline code are left exactly as written |
| Missing icons | characters that cannot be drawn show as `□U+E5EE` instead of a blank |

## Usage

| You want | Say something like |
|---|---|
| An icon in a list or heading | “use `[[nf:python]]` for the Python item” |
| The right codepoint for a glyph | “look up the docker icon”, “what is U+E0A0?” → `nerdfont_lookup` |
| An aligned table, status bar or poster | “render this as a boxed table” → `render_preview` |
| Starship's default symbol for a module | “starship nodejs symbol” → `nerdfont_lookup` |

`nerdfont_lookup` reads the fonts actually installed on your machine, so its results
match what your terminal can draw. `render_preview` does width arithmetic instead:
CJK and emoji count as two columns, private-use characters as one. Neither guesses a
codepoint.

## Troubleshooting

| You see | Why | What to do |
|---|---|---|
| `□U+E5EE` in a message | that codepoint has no glyph in your terminal's font chain, or the chain could not be identified | install a Nerd Font and set it as the terminal font; the marker names the exact codepoint |
| The icon is gone entirely | the model wrote the raw character and the stream deleted it before anything could see it | ask for the escape form (`\uE235`) or the `[[nf:name]]` marker |
| `could not be resolved — font lookup unavailable` | `python3` or fontTools is missing | `pip install fonttools`, or ignore it — everything else still works |
| `\uE235` visible inside a fenced block | intended: code stays literal so it can be copied | nothing to fix |

## Settings

| Variable | Default | When you need it |
|---|---|---|
| `PI_NF_FONT_PATHS` | fontconfig's `monospace` chain | macOS, Windows, or a terminal font that is not fontconfig's `monospace`: point at the font files or directories (platform path separator) |
| `PI_NF_CMAP_CACHE` | `~/.cache/pi-nerdfont-unescape/cmap.json` | to move the glyph cache; safe to delete, rebuilt next session |
| `PI_RENDER_ALLOW_ANY` | unset | lets `render_preview` write outside the working directory and `/tmp` |

## Development

Tests, the mutation audit and the model-free TUI probes are covered in
[DEVELOPMENT.md](./DEVELOPMENT.md).

## License

MIT. Keep the copyright and license notice when you use it.

The `nerdfont_lookup` tool embeds the default symbol table from
[starship](https://starship.rs) (`starship print-config --default`, ISC license):
only the module names and their codepoints, no starship code.
