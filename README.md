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
| Visible substitution | codepoints with **no renderable glyph** (noncharacters, Tags, unassigned BMP, or absent from your local fonts' cmap union) become visible `□U+FDD0` markers — never invisible |
| Trace filling | structural leftovers of dropped chars (empty quote pairs, codepoint comments) get `□` in place, with a warning naming the lost regions |
| Input auto-escaping | at-risk chars in **your outgoing messages** are auto-escaped (the channel strips them on input too) — the model actually receives what you pasted |
| Stream drop detection | at-risk codepoints seen in `message_update` but missing from the final message are reported with codepoints |
| Font ground truth | union of all installed fonts' cmaps, cached with signature-based invalidation; Linux / macOS / Windows paths |
| `nerdfont_lookup` tool | query installed Nerd Font glyphs by keyword or codepoint; family-prioritized; includes baked starship defaults |
| `render_preview` tool | monospace-grid layout renderer with exact terminal width arithmetic (CJK=2, PUA=1), dot leaders, frames |

## Install

```bash
pi install npm:pi-nerdfont-unescape
```

## Testing & the vision-verify workflow

`tests/test-nerdfont-unescape.cjs` — 20-case regression suite including
every historical bug form.

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
