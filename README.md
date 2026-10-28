**English** · [简体中文](./README.zh-CN.md)

# pi-nerdfont-unescape

Make Nerd Font icon output from LLMs **lossless and observable** in the Pi
TUI — and never let a character disappear silently again.

LLM tokenizers do not know Private Use Area codepoints (where Nerd Font
icons live). When a model tries to emit one, the character is dropped by
the channel without a trace — you see nothing, and you don't even know
something was missing. This extension attacks that silent failure from
both directions:

- **Protocol (soft)**: a system-prompt appendix tells the model to write
  icons as ASCII escapes (`\uE235`, `\u{f0805}`) — escapes tokenize fine
  everywhere, and the extension restores them to real glyphs when the
  message lands
- **Guards (hard)**: whatever the model does, nothing fails silently

## Feature matrix

| Feature | Behavior |
|---|---|
| Escape restoration | `\uXXXX` / `\u{xxxxx}` → real glyph, outside code spans |
| Code-span protection | fenced blocks **and** inline spans (CommonMark equal-length delimiters, incl. double-backtick wrapping) keep escapes literal — copy-paste safe for config files |
| Visible substitution | codepoints with **no renderable glyph** (noncharacters, Tags, unassigned BMP, absent from the configured terminal font chain, or whenever that chain is unavailable) become visible `□U+FDD0` markers — never invisible |
| Evidence-only trace filling | when the text itself names a lost codepoint (Lua-style `-- U+E235` comments) a trailing `□` is appended; empty quote pairs are never touched (a legit `""` and a dropped char are bit-identical — undecidable, and we refuse to guess) |
| Input auto-escaping | at-risk chars in **your outgoing messages** are auto-escaped (the channel strips them on input too) — the model actually receives what you pasted |
| Stream drop detection | at-risk codepoints seen in `message_update` but missing from the final message are reported with codepoints |
| Font ground truth | active terminal font/fallback cmaps, cached with signature-based invalidation; Linux uses the ordered fontconfig monospace chain, while `PI_NF_FONT_PATHS` provides an explicit cross-platform chain |
| `[[nf:name]]` semantic markers (beta) | write `[[nf:python]]`, the extension resolves it against **your local fonts** at render time and warns visibly on unknown names; markers inside code spans stay literal |
| `nerdfont_lookup` tool | query installed Nerd Font glyphs by keyword or codepoint; family-prioritized; includes baked starship defaults |
| `render_preview` tool | monospace-grid layout renderer with terminal-compatible Unicode width arithmetic (CJK/emoji=2, PUA=1), dot leaders, frames |

## Install

```bash
pi install npm:pi-nerdfont-unescape
```

> Not yet published — until the first release, install from a local clone:
> `pi install /path/to/pi-nerdfont-unescape`.

## Runtime & testing dependencies

The extension has one small npm runtime dependency (`typebox`). The glyph
ground truth (cmap cache), `nerdfont_lookup`, and `render_preview` shell out
to `python3` with [fontTools](https://fonttools.readthedocs.io/) — when
missing, substitution degrades to category-only judgement **with a visible
warning** (never silent). The test suites require the same. On Windows,
`python3` may not exist by that name; expose one (e.g. via `py -3` shim).

On Linux, the extension reads fontconfig's ordered `monospace` fallback chain.
On macOS, Windows, or terminals whose configured font differs from fontconfig,
set `PI_NF_FONT_PATHS` to the actual font and fallback files (or directories),
separated with the platform path separator. If the active chain cannot be
identified, the extension deliberately shows `□U+XXXX` instead of guessing
from unrelated installed fonts.

## Testing & the vision-verify workflow

`tests/test-nerdfont-unescape.cjs` + `test-tools.cjs` — full regression suites
(count grows with precedents) including every historical bug form. They build
a tiny deterministic font fixture, so results do not depend on workstation
fonts. GitHub CI runs both the regression and mutation suites.

`npm run test:audit` proves the tests are real: every mutation of the
extension must turn a specific test red. It prints one line per mutation with
elapsed time and a live ETA, runs mutations in parallel (`--jobs`), and
journals each verdict to `/tmp/pi-mutation-journal-<source-hash>.json` — an
interrupted run resumes where it stopped, and any source edit invalidates the
journal automatically (so a resumed run can never report a stale green).

```bash
npm run test:audit -- --only "M6[0-9]" --jobs 4   # targeted slice, seconds
npm run test:audit -- --fresh                     # ignore the journal
npm run test:audit -- --list                      # names only
```

All entry points are idempotent: temporary state lives under `/tmp`, keyed by
pid or source hash, and is swept on the next run if a process was killed.

### TUI acceptance without a model

`scripts/tui-probe/run.sh` renders a fixed message in the **real** pi TUI and
prints the screen: a local OpenAI-compatible server (`fake-openai-server.cjs`)
answers with the canned text, `fake-provider.ts` registers it as a provider, and
pi runs inside tmux so `tmux capture-pane` can read what the user would see.

```bash
scripts/tui-probe/run.sh            # print the rendered screen
CHECK=1 scripts/tui-probe/run.sh    # assert the demo message's expectations
```

Note for anyone extending this: never redirect stdout inside the tmux command —
pi detects a non-TTY and silently degrades to plain text.

`scripts/tui-probe/pixel.sh` goes one level deeper and captures **pixels**: GNOME
Wayland has no silent CLI screenshot (the Shell D-Bus method is AccessDenied since
43, the portal always asks), and Weston's own screenshooter is refused
("unauthorized"), so it runs Xvfb — a virtual X server — starts the user's WezTerm
inside it (software front end, same fonts), drives the same fake model, and grabs
the screen with ImageMagick. Nothing appears on the real desktop.

```bash
npm run tui:pixel            # writes scripts/tui-probe/out.png
DROP_PUA=1 scripts/tui-probe/run.sh scripts/tui-probe/message-drop.txt
```

The second command is the one that reproduces the *origin* defect: `DROP_PUA=1`
makes the fake channel behave like a real model output pipe — BMP Private Use
characters are silently removed. Observed behaviour: the protocol form
(`\uE235`) passes through and is restored, a raw PUA character is gone without a
trace the extension could read (documented limit), and a line that names the
codepoint (`icon lost -- U+E0B0`) gets a visible □ appended.

Two traps learned the hard way: unset `WAYLAND_DISPLAY` (otherwise WezTerm opens on
the real desktop instead of the virtual X screen) and capture with
`import -window root -screen` (plain `-window root` reads the root window, which is
black where child windows are).

### Resource guards (why `npm test` is wrapped)

Every suite runs through `scripts/safe-run.sh`, which puts the workload in its
own cgroup with a hard ceiling (`MemoryMax=2G`, `MemorySwapMax=512M`) and refuses
to start when less than 2 GB is available. This is not ceremony: an earlier
parallel audit on a 15.8 GB workstation that already had ~21 GB in swap hit the
*kernel's global OOM*, which killed the browser and took the desktop session
down with it. With a cgroup ceiling the kernel can only kill this workload, and
the mutation audit now defaults to **one worker** (use `--jobs N` explicitly if
you want parallelism). Temporary scopes disappear when the command exits, so an
interrupted run leaves nothing behind.

**Rendering correctness is ultimately judged by pixels**: unit tests can
lie green (two documented ways in the suite header). After significant
changes, send a real message exercising the new behavior, screenshot it,
and have a vision model audit the **pixels** — never feed it extracted or
restored text; text cannot validate rendering. This workflow caught a real
bug that 12 green unit tests missed.

If the session model itself accepts images, the agent simply reads the
screenshot (no script needed — trying to `read` a png makes Pi state
plainly whether the model supports images). Otherwise run
`python3 tests/vision-verify.py <screenshot>`. The vision model is **not
hardcoded** — resolve order: `PI_VISION_MODEL` / `PI_VISION_BASE_URL` /
`PI_VISION_API_KEY` env vars →
`~/.config/pi-nerdfont-unescape/vision.json` → fallback default
(`glm-5.3-flash` via Pi's credentials). Any OpenAI-compatible endpoint
works; forks should set level ① or ②.

## Boundary note: transcript is not ASCII

`[[nf:]]` markers are resolved at `message_end` — the only interception
point pi extensions have — which feeds **both display and storage**. The
transcript therefore stores the restored characters. A render-boundary-only
substitution (ASCII transcript + glyph at paint time) would require core
support pi does not expose today.

## Design history (condensed)

Born from a 2026-09 channel audit (3310 probes, bidirectional): BMP PUA is
always stripped; other at-risk regions pass but models can't emit them
reliably (0/3 blind accuracy on PUA). 2026-10: visible substitution for
inherently-invisible codepoints, cmap ground truth, input-side escaping,
stream drop detection, and the CommonMark v2 inline scanner (the v1 regex
was defeated by double-backtick wrapping — caught by visual verification,
not by tests).

## License

MIT — keep the copyright and license notice when you use it.
