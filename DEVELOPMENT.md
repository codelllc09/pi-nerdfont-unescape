# Development

Maintainer notes. For what the extension does and how to use it, see
[README.md](./README.md).

## Layout

```
nerdfont-unescape.ts    the extension (single file): protocol injection, the
                        transform pipeline, and the two tools
tests/lib.cjs           locates pi, loads the extension, builds font fixtures
tests/test-*.cjs        two regression suites (112 assertions)
tests/mutation-audit.cjs  86 mutations; proves every assertion can fail
tests/guard-layout.cjs file identity + build-portability guard
tests/gen-review.cjs   generates review.html: every case with its expected value
scripts/safe-run.sh    cgroup memory ceiling; all suites run through it
scripts/tui-probe/     model-free TUI probes (see below)
```

## Tests

```bash
npm test                  # 112 assertions, no model calls, ~20 s
npm run test:audit        # 86 mutations, proves each assertion can fail
npm run test:audit -- --only "M6[0-9]" --jobs 4   # targeted slice
npm run test:audit -- --fresh                     # ignore the resume journal
npm run test:audit -- --list                      # mutation names only
```

Rules that keep the suite honest:

- Every fixed bug keeps a regression case; every new behaviour ships with a
  mutation that kills its test. A test no mutation can kill is decoration.
- Tests build their own font fixtures, so results never depend on the fonts
  installed on the machine. A missing `python3` fails the suite loudly instead of
  skipping it.
- `npm test` needs `python3` + fontTools (`pip install fonttools`).
- The audit journals verdicts to `/tmp/pi-mutation-journal-<source-hash>.json`;
  any source edit invalidates the journal, so a resumed run cannot report a stale
  green.

### Why suites go through `scripts/safe-run.sh`

A parallel audit on a 15.8 GB workstation once triggered the kernel's global OOM
and took the desktop session with it. The wrapper puts the workload in its own
cgroup (`MemoryMax=2G`, `MemorySwapMax=512M`) and refuses to start below 2 GB
available (`PI_FORCE=1` overrides). The audit defaults to one worker; `--jobs N`
opts into more.

## TUI probes (no model, no network)

`scripts/tui-probe/fake-openai-server.cjs` is an OpenAI-compatible server that
replies with a fixed message; `fake-provider.ts` registers it as a provider. The
real TUI renders it, and the probes read back what a user would see.

```bash
scripts/tui-probe/run.sh        # print the rendered screen (tmux capture-pane)
CHECK=1 scripts/tui-probe/run.sh  # assert the demo message's expectations
npm run tui:pixel               # capture the same screen as a PNG (Xvfb)
```

- `run.sh` reads the character grid — layout, gutters, notifications.
- `pixel.sh` reads pixels, which is the only way to prove glyphs actually paint
  rather than merely being present as codepoints. It needs `Xvfb` and ImageMagick.
  GNOME's screenshot APIs are unavailable to scripts (D-Bus `AccessDenied` since
  43; the portal always prompts) and Weston refuses its own screenshooter, hence
  the virtual X display.
- `DROP_PUA=1 scripts/tui-probe/run.sh scripts/tui-probe/message-drop.txt`
  reproduces the original defect: the fake channel removes private-use characters
  from its output, showing all three outcomes in one frame (escape restored, raw
  character gone, codepoint hint turned into `□`).

Traps, all of which cost real time: never redirect stdout inside the tmux command
(pi sees no TTY and silently degrades to plain text); unset `WAYLAND_DISPLAY` or
the terminal opens on the real desktop; capture with `import -window root -screen`
(plain `-window root` is black where child windows are).

## Design notes

- **Escapes, not raw glyphs.** Tokenizers do not know private-use codepoints, so
  an icon written as a character is a coin flip.
- **Nothing is guessed.** Unknown font state renders `□U+XXXX` rather than a
  plausible glyph; a missing signal produces silence rather than an invented
  warning.
- **The channel cannot be repaired from here.** This runs after the bytes arrive:
  it rebuilds what the model encoded and makes visible what it cannot rebuild.
- **Rendering correctness is judged by pixels.** Unit tests have been green while
  the rendered result was wrong; a screenshot settled it. Never feed a vision
  model extracted or restored text — only pixels.
- **`message_end` feeds display *and* storage** (the extension API has no
  paint-time-only hook), which is why the transcript stores restored characters.

Local working notes (not in version control) live in `AGENTS.md`.
