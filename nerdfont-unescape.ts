// nerdfont-unescape — restore/expose BMP Private Use characters dropped by the model output channel
// ────────────────────────────────────────────────────────────
// Background: the model output channel silently strips BMP Private Use
// characters (U+E000–U+F8FF, where all Nerd Font dev-/seti-/cod-/fa-/
// oct-/custom-/linux- icons live). A 2026-09 full audit (3310 probes,
// bidirectional cross-checks) proved raw characters in that range never
// survive the channel (stripped in BOTH directions). Other ranges —
// PUA-A/B, Tags, noncharacters, astral unassigned, CJK ext G+ — pass,
// but blind emission is unreliable (0/3 exact on PUA, ~28% astral
// neighbor-offset), so they join the escape protocol. Dropped characters
//
// Three lines of defense (one message_end handler, in order):
//   1. Escape restoration: turn \uXXXX / \u{xxxx} (ranges proven dropped)
//      back into real characters (String.fromCodePoint, purely
//      client-side — bytes never lost)
//   2. Evidence-only trace filling: when the text itself names the lost
//      codepoint (Lua-style "-- U+E235" comments), append □ (U+25A1) so the
//      loss is visible; empty quote pairs are NOT touched — a legit "" and a
//      dropped char are bit-identical and we refuse to guess

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";

const TOFU = "\u25A1"; // □ missing-glyph box
const PROTOCOL_TITLE = "[nerdfont-unescape output protocol]"; // single source of truth for injection + idempotency
const visibleMarker = (cp: number): string =>
  `${TOFU}U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

// BMP assigned-range table, generated from local Python unicodedata
// (Unicode 16.0.0). Unassigned BMP codepoints are dropped by the channel
// (verified via U+0378), hence in scope; astral unassigned pass — out of scope. Regeneration notes at the file tail.
const ASSIGNED_BMP_RAW = "0-377,37a-37f,384-38a,38c-38c,38e-3a1,3a3-52f,531-556,559-58a,58d-58f,591-5c7,5d0-5ea,5ef-5f4,600-70d,70f-74a,74d-7b1,7c0-7fa,7fd-82d,830-83e,840-85b,85e-85e,860-86a,870-88e,890-891,897-983,985-98c,98f-990,993-9a8,9aa-9b0,9b2-9b2,9b6-9b9,9bc-9c4,9c7-9c8,9cb-9ce,9d7-9d7,9dc-9dd,9df-9e3,9e6-9fe,a01-a03,a05-a0a,a0f-a10,a13-a28,a2a-a30,a32-a33,a35-a36,a38-a39,a3c-a3c,a3e-a42,a47-a48,a4b-a4d,a51-a51,a59-a5c,a5e-a5e,a66-a76,a81-a83,a85-a8d,a8f-a91,a93-aa8,aaa-ab0,ab2-ab3,ab5-ab9,abc-ac5,ac7-ac9,acb-acd,ad0-ad0,ae0-ae3,ae6-af1,af9-aff,b01-b03,b05-b0c,b0f-b10,b13-b28,b2a-b30,b32-b33,b35-b39,b3c-b44,b47-b48,b4b-b4d,b55-b57,b5c-b5d,b5f-b63,b66-b77,b82-b83,b85-b8a,b8e-b90,b92-b95,b99-b9a,b9c-b9c,b9e-b9f,ba3-ba4,ba8-baa,bae-bb9,bbe-bc2,bc6-bc8,bca-bcd,bd0-bd0,bd7-bd7,be6-bfa,c00-c0c,c0e-c10,c12-c28,c2a-c39,c3c-c44,c46-c48,c4a-c4d,c55-c56,c58-c5a,c5d-c5d,c60-c63,c66-c6f,c77-c8c,c8e-c90,c92-ca8,caa-cb3,cb5-cb9,cbc-cc4,cc6-cc8,cca-ccd,cd5-cd6,cdd-cde,ce0-ce3,ce6-cef,cf1-cf3,d00-d0c,d0e-d10,d12-d44,d46-d48,d4a-d4f,d54-d63,d66-d7f,d81-d83,d85-d96,d9a-db1,db3-dbb,dbd-dbd,dc0-dc6,dca-dca,dcf-dd4,dd6-dd6,dd8-ddf,de6-def,df2-df4,e01-e3a,e3f-e5b,e81-e82,e84-e84,e86-e8a,e8c-ea3,ea5-ea5,ea7-ebd,ec0-ec4,ec6-ec6,ec8-ece,ed0-ed9,edc-edf,f00-f47,f49-f6c,f71-f97,f99-fbc,fbe-fcc,fce-fda,1000-10c5,10c7-10c7,10cd-10cd,10d0-1248,124a-124d,1250-1256,1258-1258,125a-125d,1260-1288,128a-128d,1290-12b0,12b2-12b5,12b8-12be,12c0-12c0,12c2-12c5,12c8-12d6,12d8-1310,1312-1315,1318-135a,135d-137c,1380-1399,13a0-13f5,13f8-13fd,1400-169c,16a0-16f8,1700-1715,171f-1736,1740-1753,1760-176c,176e-1770,1772-1773,1780-17dd,17e0-17e9,17f0-17f9,1800-1819,1820-1878,1880-18aa,18b0-18f5,1900-191e,1920-192b,1930-193b,1940-1940,1944-196d,1970-1974,1980-19ab,19b0-19c9,19d0-19da,19de-1a1b,1a1e-1a5e,1a60-1a7c,1a7f-1a89,1a90-1a99,1aa0-1aad,1ab0-1ace,1b00-1b4c,1b4e-1bf3,1bfc-1c37,1c3b-1c49,1c4d-1c8a,1c90-1cba,1cbd-1cc7,1cd0-1cfa,1d00-1f15,1f18-1f1d,1f20-1f45,1f48-1f4d,1f50-1f57,1f59-1f59,1f5b-1f5b,1f5d-1f5d,1f5f-1f7d,1f80-1fb4,1fb6-1fc4,1fc6-1fd3,1fd6-1fdb,1fdd-1fef,1ff2-1ff4,1ff6-1ffe,2000-2064,2066-2071,2074-208e,2090-209c,20a0-20c0,20d0-20f0,2100-218b,2190-2429,2440-244a,2460-2b73,2b76-2b95,2b97-2cf3,2cf9-2d25,2d27-2d27,2d2d-2d2d,2d30-2d67,2d6f-2d70,2d7f-2d96,2da0-2da6,2da8-2dae,2db0-2db6,2db8-2dbe,2dc0-2dc6,2dc8-2dce,2dd0-2dd6,2dd8-2dde,2de0-2e5d,2e80-2e99,2e9b-2ef3,2f00-2fd5,2ff0-303f,3041-3096,3099-30ff,3105-312f,3131-318e,3190-31e5,31ef-321e,3220-a48c,a490-a4c6,a4d0-a62b,a640-a6f7,a700-a7cd,a7d0-a7d1,a7d3-a7d3,a7d5-a7dc,a7f2-a82c,a830-a839,a840-a877,a880-a8c5,a8ce-a8d9,a8e0-a953,a95f-a97c,a980-a9cd,a9cf-a9d9,a9de-a9fe,aa00-aa36,aa40-aa4d,aa50-aa59,aa5c-aac2,aadb-aaf6,ab01-ab06,ab09-ab0e,ab11-ab16,ab20-ab26,ab28-ab2e,ab30-ab6b,ab70-abed,abf0-abf9,ac00-d7a3,d7b0-d7c6,d7cb-d7fb,e000-fa6d,fa70-fad9,fb00-fb06,fb13-fb17,fb1d-fb36,fb38-fb3c,fb3e-fb3e,fb40-fb41,fb43-fb44,fb46-fbc2,fbd3-fd8f,fd92-fdc7,fdcf-fdcf,fdf0-fe19,fe20-fe52,fe54-fe66,fe68-fe6b,fe70-fe74,fe76-fefc,feff-feff,ff01-ffbe,ffc2-ffc7,ffca-ffcf,ffd2-ffd7,ffda-ffdc,ffe0-ffe6,ffe8-ffee,fff9-fffd";

const ASSIGNED_BMP: Array<[number, number]> = ASSIGNED_BMP_RAW.split(",").map(
  (r) => r.split("-").map((h) => parseInt(h, 16)) as [number, number],
);

function isAssignedBmp(cp: number): boolean {
  let lo = 0;
  let hi = ASSIGNED_BMP.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ASSIGNED_BMP[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}
// Codepoints empirically dropped by the model output channel (font-coverage independent)
function isAtRisk(cp: number): boolean {
  return (
    (cp <= 0xffff && !isAssignedBmp(cp)) || // unassigned BMP (dropped in practice)
    (cp >= 0xe000 && cp <= 0xf8ff) || // BMP PUA (the Nerd Font heartland)
    (cp >= 0xf0000 && cp <= 0xffffd) || // PUA-A (md- icons)
    (cp >= 0x100000 && cp <= 0x10fffd) || // PUA-B（Plane 15/16）
    (cp >= 0xe0000 && cp <= 0xe007f) || // Tags block
    (cp >= 0xfdd0 && cp <= 0xfdef) || // noncharacters
    (cp & 0xfffe) === 0xfffe // U+xFFFE / U+FFFF on any plane
  );
}

/** Inherently invisible: no font may ever assign glyphs here (Unicode
 * forbids it), so restoring would CREATE a silent failure — substitute a visible □U+XXXX marker */
/** Noncharacters: Unicode forbids glyphs for these on every plane */
function isNoncharacter(cp: number): boolean {
  return (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe;
}

function isInherentlyInvisible(cp: number): boolean {
  return (
    isNoncharacter(cp) ||
    (cp >= 0xe0000 && cp <= 0xe007f) || // Tags (format chars, invisible by design)
    (cp <= 0xffff && !isAssignedBmp(cp)) // unassigned BMP (no glyph anywhere; may render blank)
  );
}

// ── Local font glyph ground truth ──────────────────────────────
// Category checks only cover "no font could ever have a glyph". For
// maybe-glyph codepoints (PUA etc.) the authority is the ACTIVE terminal
// font/fallback chain — never the union of every installed font, which would
// claim glyphs the terminal cannot reach (review round 16). The chain comes
// from PI_NF_FONT_PATHS (explicit, cross-platform) or, on Linux, the ordered
// `fc-match -s monospace` list; with neither, the scan refuses to run and the
// decision stays conservative (□U+XXXX) instead of guessing. Scan once, cache
// to disk with a signature, reuse in-process.
import * as os from "node:os";

const CMAP_CACHE =
  process.env.PI_NF_CMAP_CACHE ??
  (process.platform === "win32"
    ? `${process.env.LOCALAPPDATA ?? os.homedir()}\\pi-nerdfont-unescape\\cmap.json`
    : process.platform === "darwin"
      ? `${os.homedir()}/Library/Caches/pi-nerdfont-unescape/cmap.json`
      : `${os.homedir()}/.cache/pi-nerdfont-unescape/cmap.json`);
const CMAP_STORE = Symbol.for("pi.nerdfontUnescape.cmap");
const CMAP_SIG = Symbol.for("pi.nerdfontUnescape.cmapSig"); // must live globally: module vars reset on reload
const CMAP_ASYNC_STATE = Symbol.for("pi.nerdfontUnescape.cmapAsyncState");
// Texts this pipeline has already emitted. Chained/duplicated message_end
// handlers (double registration, a /reload that left the old instance alive)
// feed our own output back in: the hatched form `\ue235` is a single-backslash
// literal that a second pass would happily restore into a glyph, corrupting a
// deliberate literal (round 17). Bounded FIFO, exact match only — a genuine
// model message is never byte-identical to a whole emitted message by accident.
const EMITTED = Symbol.for("pi.nerdfontUnescape.emitted");
const EMITTED_MAX = 16;
// Deliberately NOT keyed by the font signature (round 20): after a font change,
// re-evaluating our own output would turn a hatched literal (`\ue235`, shown
// with one backslash on purpose) back into a glyph — corruption. Outputs that
// carry □U+XXXX markers contain no escapes, so re-processing them is a no-op
// anyway; the guard can stay purely textual.
function emittedTexts(): string[] {
  const g = globalThis as any;
  if (!Array.isArray(g[EMITTED])) g[EMITTED] = [];
  return g[EMITTED] as string[];
}
function pushedEmitted(text: string): void {
  const list = emittedTexts();
  list.push(text);
  while (list.length > EMITTED_MAX) list.shift();
}
const joinBlocks = (blocks: any[]): string =>
  blocks.map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : "\u0000")).join("\u0000");

type Ranges = Array<[number, number]>;

const CMAP_BUILD_PY = `
import glob, json, os, shutil, subprocess, sys, tempfile

def font_files(root):
    root = os.path.abspath(os.path.expanduser(root))
    if os.path.isdir(root):
        return glob.glob(os.path.join(root, "**", "*"), recursive=True)
    return [root]

def discover_fonts():
    # PI_NF_FONT_PATHS is the authoritative terminal font/fallback list. A
    # directory is expanded recursively; entries use the platform path separator.
    explicit = os.environ.get("PI_NF_FONT_PATHS", "").strip()
    if explicit:
        found = []
        for item in explicit.split(os.pathsep):
            if item.strip():
                found += font_files(item.strip())
        return found, "explicit"
    # On Linux, fontconfig's ordered monospace fallback chain is materially
    # closer to what a terminal can render than the union of every installed
    # font. Other platforms cannot expose the active terminal font reliably;
    # require an explicit list instead of claiming false-positive support.
    if sys.platform.startswith("linux") and shutil.which("fc-match"):
        try:
            out = subprocess.check_output(
                ["fc-match", "-s", "--format=%{file}\\n", "monospace"],
                text=True, timeout=15)
            return [p for p in out.splitlines() if p], "fontconfig-monospace"
        except Exception as e:
            print("fontconfig lookup failed: %s" % e, file=sys.stderr)
    return [], "unconfigured"

fonts, source = discover_fonts()
fonts = sorted(set(f for f in fonts if os.path.isfile(f) and f.lower().endswith((".ttf", ".ttc", ".otf"))))
if not fonts:
    print("active terminal font chain unknown; set PI_NF_FONT_PATHS to the terminal font and fallback files", file=sys.stderr)
    sys.exit(4)

def sig(files):
    import hashlib
    h = hashlib.sha256()
    for p in files:
        try:
            st = os.stat(p)
            h.update(("%s:%d:%d\\n" % (p, st.st_size, st.st_mtime_ns)).encode())
        except OSError:
            pass
    return h.hexdigest()

# Signature checks must not parse every cmap. This is the cheap cache path.
if len(sys.argv) > 2 and sys.argv[2] == "sig":
    print(sig(fonts)); sys.exit(0)

cps = set()
try:
    from fontTools.ttLib import TTCollection, TTFont
    for p in fonts:
        try:
            if p.lower().endswith(".ttc"):
                # TTCollection faces SHARE one file handle: closing a face closes
                # the handle for the rest and every later face dies with "seek of
                # closed file", silently dropping its glyphs (round 19). Read all
                # cmaps first, then close the collection once.
                coll = TTCollection(p, lazy=True)
                try:
                    for face in coll.fonts:
                        cps.update((face.getBestCmap() or {}).keys())
                finally:
                    coll.close()
            else:
                face = TTFont(p, lazy=True)
                try:
                    cps.update((face.getBestCmap() or {}).keys())
                finally:
                    face.close()
        except Exception as e:
            print("font skipped %s: %s" % (p, e), file=sys.stderr)
except ImportError:
    sys.exit(3)  # fontTools missing: stay unknown, write no cache
rs, s, prev = [], None, None
for cp in sorted(cps):
    if s is None: s = prev = cp
    elif cp == prev + 1: prev = cp
    else: rs.append([s, prev]); s = prev = cp
if s is not None: rs.append([s, prev])
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(sys.argv[1]))
data = json.dumps({"schema": 2, "fonts": len(fonts), "ranges": rs, "sig": sig(fonts), "source": source})
with os.fdopen(fd, "w") as out:
    out.write(data)
os.replace(tmp, sys.argv[1])
print("cmap cache: %d terminal-chain fonts, %d ranges (%s)" % (len(fonts), len(rs), source))
`;

function validRanges(value: unknown): value is Ranges {
  if (!Array.isArray(value)) return false;
  let previousEnd = -1;
  for (const item of value) {
    if (
      !Array.isArray(item) || item.length !== 2 ||
      !Number.isInteger(item[0]) || !Number.isInteger(item[1]) ||
      item[0] < 0 || item[0] > item[1] || item[1] > 0x10ffff ||
      item[0] <= previousEnd
    ) return false;
    previousEnd = item[1];
  }
  return true;
}

function inRanges(rs: Ranges, cp: number): boolean {
  let lo = 0;
  let hi = rs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = rs[mid];
    if (!Array.isArray(range) || range.length !== 2) return false;
    if (cp < range[0]) hi = mid - 1;
    else if (cp > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Load the disk cache into shared storage; return false when absent,
 * corrupt, or [missing a signature]. Legacy caches (ranges without sig)
 * count as a failed migration and trigger a rebuild — a silent blind spot otherwise (review precedent). */
function loadCmapCache(): boolean {
  try {
    const data = JSON.parse(require("node:fs").readFileSync(CMAP_CACHE, "utf8"));
    if (data.schema !== 2 || !validRanges(data.ranges) || typeof data.sig !== "string" || data.sig.length === 0) return false;
    (globalThis as any)[CMAP_STORE] = data.ranges as Ranges;
    cmapSig = data.sig;
    (globalThis as any)[CMAP_SIG] = cmapSig; // mirror globally: NF-cache invalidation basis
    return true;
  } catch {
    return false;
  }
}

/** Build/refresh the cache in the background (session_start, non-blocking). */
let cmapSig: string | undefined;

type CmapAsyncState = { checking: boolean; building: boolean };

function cmapAsyncState(): CmapAsyncState {
  const g = globalThis as any;
  if (!(g[CMAP_ASYNC_STATE] && typeof g[CMAP_ASYNC_STATE] === "object")) {
    g[CMAP_ASYNC_STATE] = { checking: false, building: false } satisfies CmapAsyncState;
  }
  return g[CMAP_ASYNC_STATE] as CmapAsyncState;
}

function processErrorSummary(err: Error | null, stderr: unknown): string {
  const tail = String(stderr ?? "").trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ");
  const raw = tail || err?.message || "unknown process error";
  const text = raw.replace(/\s+/g, " ").slice(0, 240);
  // ENOENT here always means the python3 executable itself is missing: say what
  // to install instead of echoing a bare errno (round 18).
  return /ENOENT/.test(text) ? `python3 not found (${text}) — install python3 + fontTools` : text;
}

function buildCmapCache(notify?: (msg: string, level: string) => void): void {
  const state = cmapAsyncState();
  if (state.building) return;
  state.building = true;
  execFile("python3", ["-c", CMAP_BUILD_PY, CMAP_CACHE], { timeout: 120000, maxBuffer: 1 << 24 },
    (err, stdout, stderr) => {
      state.building = false;
      if (!err) {
        loadCmapCache();
        console.error(`[nerdfont-unescape] ${String(stdout).trim()}`);
        return;
      }
      // Failure (incl. missing fontTools): inherently-invisible codepoints
      // still substitute visibly; everything else degrades conservatively to
      // □U+XXXX — and the degrade must leave a trace (red line):
      const reason = processErrorSummary(err, stderr);
      const advice = reason.includes("PI_NF_FONT_PATHS")
        ? "set PI_NF_FONT_PATHS to the active terminal font and fallback files"
        : "install python3 + fontTools and verify the active terminal font configuration";
      const msg = `nerdfont-unescape: cmap unavailable (${reason}) — at-risk escapes will render as visible □U+XXXX markers (conservative: unknown font state counts as no glyph); ${advice}`;
      console.error(`[nerdfont-unescape] cmap build FAILED: ${reason}`);
      notify?.(msg, "warning");
    });
}

function checkCmapSignature(notify?: (msg: string, level: string) => void): void {
  const state = cmapAsyncState();
  if (state.checking || state.building) return;
  state.checking = true;
  execFile("python3", ["-c", CMAP_BUILD_PY, CMAP_CACHE, "sig"], { timeout: 20000, maxBuffer: 1 << 16 },
    (err, stdout, stderr) => {
      state.checking = false;
      const cur = err ? undefined : String(stdout).trim();
      if (err || !cur) {
        const reason = err ? processErrorSummary(err, stderr) : "empty signature response";
        const msg = `nerdfont-unescape: font signature check failed (${reason}); cmap invalidation detection is temporarily unavailable`;
        console.error(`[nerdfont-unescape] cmap signature check FAILED: ${reason}`);
        notify?.(msg, "warning");
        return;
      }
      if (cur !== (globalThis as any)[CMAP_SIG]) buildCmapCache(notify);
    });
}

function ensureCmapCache(notify?: (msg: string, level: string) => void): void {
  const g = globalThis as any;
  if (g[CMAP_STORE]) {
    // Reload path: cmap is already global, but THIS instance's cmapSig is a
    // fresh undefined — backfill from the global or the comparison never works (review precedent)
    if (cmapSig === undefined && typeof g[CMAP_SIG] === "string") cmapSig = g[CMAP_SIG];
    // Hot-upgrade path: the round-5 build left CMAP_STORE but no CMAP_SIG —
    // recover the signature from disk (mirrored globally); if gone/legacy, rebuild in background
    if (typeof g[CMAP_SIG] !== "string") {
      if (!loadCmapCache()) {
        buildCmapCache(notify);
        return;
      }
    }
    checkCmapSignature(notify);
    return;
  }
  if (!loadCmapCache()) {
    buildCmapCache(notify); // no cache yet: first build
    return;
  }
  // Keep serving the previous map while checking for font changes in background.
  checkCmapSignature(notify);
}

// [[nf:name]] semantic protocol (v0.2): the model writes icon SEMANTIC
// names; the extension resolves them against local fonts into \uXXXX
// escapes and reuses the whole pipeline. Markers in fences/inline code stay put (code is meant to be copied).
const NF_MARKER = /\[\[nf:([a-z0-9_.-]{1,40})\]\]/gi;
const NF_CACHE = Symbol.for("pi.nerdfontUnescape.nfCache");

// CRLF tolerance: a carriage return terminates the line, it is never fence
// content. Shared by both fence state machines (review round 15).
const stripCr = (s: string): string => s.replace(/\r$/, "");

function walkUnprotected(text: string, fn: (seg: string) => string): string {
  const FENCE = /^[ \t]*(`{3,}|~{3,})/;
  let fenceOpen: { ch: string; len: number } | null = null;
  return text
    .split("\n")
    .map((line) => {
      const fm = line.match(FENCE);
      if (fm) {
        const run = fm[1];
        const rest = stripCr(line.slice((fm.index ?? 0) + fm[0].length));
        if (!fenceOpen) fenceOpen = { ch: run[0], len: run.length };
        else if (run[0] === fenceOpen.ch && run.length >= fenceOpen.len && /^[ \t]*$/.test(rest)) fenceOpen = null;
        return line;
      }
      if (fenceOpen) return line;
      return splitByInlineSpans(line)
        .map((seg) => (seg.protected ? seg.text : fn(seg.text)))
        .join("");
    })
    .join("\n");
}

async function resolveNfMarkers(text: string, notify?: (msg: string, level: string) => void): Promise<string> {
  if (!/\[\[nf:/i.test(text)) return text; // fast path must match NF_MARKER's case-insensitivity (silent ignore = red-line violation)
  const g = globalThis as any;
  // Validate STRUCTURE, not existence: legacy builds left a bare Map
  // (survives /reload); missing sig/map fields → rebuild safely, never proceed broken (review precedent)
  if (!(g[NF_CACHE] && typeof g[NF_CACHE] === "object" && g[NF_CACHE].map instanceof Map)) {
    g[NF_CACHE] = { sig: undefined as string | undefined, map: new Map<string, number | null>() };
  }
  const store = g[NF_CACHE] as { sig: string | undefined; map: Map<string, number | null> };
  const curSig = (globalThis as any)[CMAP_SIG] as string | undefined;
  if (store.sig !== curSig) {
    store.map.clear(); // font-set fingerprint changed → drop the whole resolution cache
    store.sig = curSig; // write back the comparison basis (a module-local here re-cleared every message)
  }
  const cache = store.map;
  const wanted = new Set<string>();
  const invalid = new Set<string>();
  const LOOSE_NF = /\[\[nf:([^\[\]\n]*)\]\]/gi; // full shell, unbounded name — overlong names must be reported too (review precedent)
  const VALID_NAME = /^[a-z0-9_.-]{1,40}$/i; // exactly NF_MARKER's rule: charset + length cap
  walkUnprotected(text, (seg) => {
    for (const m of seg.matchAll(NF_MARKER)) wanted.add(m[1].toLowerCase());
    for (const m of seg.matchAll(LOOSE_NF)) {
      if (!VALID_NAME.test(m[1])) invalid.add(m[1]); // looks like [[nf:...]] but the name is illegal → must be reported
    }
    return seg;
  });
  if (invalid.size > 0) {
    notify?.(`nerdfont-unescape: invalid marker syntax (names: letters/digits/._- , max 40 chars), kept verbatim: [[nf:${[...invalid].join("]] [[nf:")}]]`, "warning");
  }
  if (wanted.size === 0) return text;
  // Failures (null) are not cached across messages — after installing fonts
  // or a transient fault the next message retries; all uncached names go through ONE batched python call (linear latency otherwise)
  const uncached = [...wanted].filter((n) => cache.get(n) == null);
  // "could not check" must never be reported as "no such name": python3 or the
  // font chain may simply be unavailable (round 18). The resolver prints a line
  // for every requested name, so empty output means it never ran.
  let resolverUnavailable = false;
  if (uncached.length > 0) {
    const out = await new Promise<string>((resolve) => {
      execFile("python3", ["-c", NF_LOOKUP_PY, `resolve:${uncached.join(",")}`, "1"], { timeout: 20000, maxBuffer: 1 << 20 },
        (err, stdout) => resolve(err ? "" : String(stdout).trim()));
    });
    if (out === "") resolverUnavailable = true;
    for (const line of out.split("\n")) {
      const m = line.match(/^([a-z0-9_.-]+) (~?[0-9a-f]+|\?)$/i); // ~hex = named but non-icon
      if (!m) continue;
      // "~hex" = the name exists but resolves to a non-icon codepoint. Cache it
      // as a negative number: still a cached answer (no repeat python call),
      // but distinguishable from "unknown name" so the warning can be truthful.
      const nonIcon = m[2].startsWith("~");
      const cp = m[2] === "?" ? null : parseInt(m[2].replace("~", ""), 16);
      // [[nf:]] is an icon protocol: only PUA codepoints may land in the text.
      // Anything else would become a literal \uXXXX that the restore pipeline
      // intentionally leaves alone (silent failure).
      cache.set(m[1].toLowerCase(), cp === null ? null : isAtRisk(cp) ? cp : -cp);
    }
    for (const n of uncached) if (!cache.has(n)) cache.set(n, null);
  }
  const unresolved: string[] = [];
  const nonIcon: string[] = [];
  const unavailable: string[] = [];
  let outText = walkUnprotected(text, (seg) =>
    seg.replace(NF_MARKER, (whole, name: string) => {
      const k = name.toLowerCase();
      const raw = cache.get(k);
      const cp = raw ?? null;
      if (cp === null || cp === undefined) {
        // Distinguish "we could not check" from "the name does not exist"
        const bucket = resolverUnavailable ? unavailable : unresolved;
        if (!bucket.includes(k)) bucket.push(k);
        return whole; // unresolved: keep the marker + name it in a warning, never silent
      }
      if (cp < 0) {
        // Named glyph exists, but outside the icon planes: keep the marker and
        // say exactly why (NOT "no such name" — that would be a lie)
        const tag = `${k} (U+${(-cp).toString(16).toUpperCase().padStart(4, "0")})`;
        if (!nonIcon.includes(tag)) nonIcon.push(tag);
        return whole;
      }
      return cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\u{${cp.toString(16)}}`;
    }),
  );
  if (unavailable.length > 0) {
    notify?.(
      `nerdfont-unescape: [[nf:${unavailable.join("]] [[nf:")}]] could not be resolved — font lookup unavailable (python3/fontTools missing, or the terminal font chain is unconfigured); markers kept verbatim`,
      "warning",
    );
  }
  if (nonIcon.length > 0) {
    notify?.(
      `nerdfont-unescape: [[nf:...]] name exists but resolves outside the icon planes: ${nonIcon.join(", ")}; marker kept verbatim ([[nf:]] only carries Nerd Font icon codepoints)`,
      "warning",
    );
  }
  if (unresolved.length > 0) {
    notify?.(`nerdfont-unescape: [[nf:${unresolved.join("]] [[nf:")}]] — no such name in local fonts; marker kept verbatim (use nerdfont_lookup to find valid names)`, "warning");
  }
  return outText;
}

function unescapeAtRisk(text: string): {
  text: string;
  restored: number;
  cps: number[];
  substituted: number[]; // inherently invisible codepoints, replaced with □U+XXXX markers
  hatched: number; // hatch literalizations (double backslash → single-backslash display)
} {
  if (!text.includes("\\u")) return { text, restored: 0, cps: [], substituted: [], hatched: 0 };
  const cps: number[] = [];
  const substituted: number[] = [];
  let hatched = 0;
  const cmap = (globalThis as any)[CMAP_STORE] as Ranges | undefined;
  // Single-pass alternation: branch A = double backslash (hatch, literalize),
  // branch B = single backslash (restore/substitute). Double tried first per
  // position; NO internal sentinel — sentinels collide with user text (review precedent: a literal \uLIT0; was once rewritten).
  const ONE_PASS = /\\{2}u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))|\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g;
  const processSegment = (seg: string) =>
    seg.replace(ONE_PASS, (whole, aBrace?: string, aPlain?: string, brace?: string, plain?: string) => {
      if (aBrace !== undefined || aPlain !== undefined) {
        hatched++; // hatch: double backslash → single-backslash literal display
        return whole.slice(1);
      }
      const cp = parseInt(brace ?? plain!, 16);
      if (isAtRisk(cp)) {
        // Two-dimensional decision (channel-risk x font-support): when cmap is
        // UNAVAILABLE the font state is unknown — treat as no-glyph (visible
        // marker), never optimistically restore (a tofu/blank would follow)
        const notInFonts = cmap === undefined || !inRanges(cmap, cp);
        if (isInherentlyInvisible(cp) || notInFonts) {
          substituted.push(cp);
          return visibleMarker(cp); // invisible or no local glyph: visible marker, refuse silent failure
        }
        cps.push(cp);
        return String.fromCodePoint(cp);
      }
      return whole; // safe range (\ufffd, \u0041, ...) kept verbatim
    });
  // Fence + inline-code protection: protected segments never reach processSegment —
  // the hatch must not touch code either (copy fidelity, review precedent)
  const FENCE = /^[ \t]*(`{3,}|~{3,})/;
  let fenceOpen: { ch: string; len: number } | null = null;
  const out = text
    .split("\n")
    .map((line) => {
      const fm = line.match(FENCE);
      if (fm) {
        const run = fm[1];
        const rest = stripCr(line.slice((fm.index ?? 0) + fm[0].length));
        if (!fenceOpen) {
          fenceOpen = { ch: run[0], len: run.length }; // opening line may carry an info string (```js)
        } else if (
          run[0] === fenceOpen.ch &&
          run.length >= fenceOpen.len &&
          /^[ \t]*$/.test(rest) // closing line must be a pure fence (```x does not close, CommonMark)
        ) {
          fenceOpen = null;
        }
        return line;
      }
      if (fenceOpen) return line;
      return splitByInlineSpans(line)
        .map((seg) => (seg.protected ? seg.text : processSegment(seg.text)))
        .join("");
    })
    .join("\n");
  return { text: out, restored: cps.length, cps, substituted, hatched };
}

// ── Codepoint → semantic region naming (for loss/restore notifications) ──
// Principle: block-level semantic names with common-use annotations;
// unlisted ranges fall back to "unassigned". Every common char deserves a meaningful name.
type Region = { lo: number; hi: number; name: string };
const REGIONS: Region[] = [
  { lo: 0x0000, hi: 0x007f, name: "ASCII" },
  { lo: 0x0080, hi: 0x024f, name: "Latin letters (extended)" },
  { lo: 0x0250, hi: 0x02ff, name: "IPA phonetics & modifiers" },
  { lo: 0x0300, hi: 0x036f, name: "combining diacritics" },
  { lo: 0x0370, hi: 0x03ff, name: "Greek" },
  { lo: 0x0400, hi: 0x052f, name: "Cyrillic" },
  { lo: 0x0530, hi: 0x058f, name: "Armenian" },
  { lo: 0x0590, hi: 0x05ff, name: "Hebrew" },
  { lo: 0x0600, hi: 0x06ff, name: "Arabic" },
  { lo: 0x0700, hi: 0x08ff, name: "Syriac & Arabic extended" },
  { lo: 0x0900, hi: 0x0dff, name: "Indic scripts" },
  { lo: 0x0e00, hi: 0x0e7f, name: "Thai" },
  { lo: 0x0e80, hi: 0x0eff, name: "Lao" },
  { lo: 0x0f00, hi: 0x0fff, name: "Tibetan" },
  { lo: 0x1000, hi: 0x109f, name: "Myanmar" },
  { lo: 0x10a0, hi: 0x10ff, name: "Georgian" },
  { lo: 0x1100, hi: 0x11ff, name: "Hangul jamo" },
  { lo: 0x1200, hi: 0x137f, name: "Ethiopic" },
  { lo: 0x13a0, hi: 0x13ff, name: "Cherokee" },
  { lo: 0x1400, hi: 0x167f, name: "Canadian Aboriginal" },
  { lo: 0x1680, hi: 0x169f, name: "Ogham" },
  { lo: 0x16a0, hi: 0x16ff, name: "Runic" },
  { lo: 0x1700, hi: 0x177f, name: "Philippine scripts" },
  { lo: 0x1780, hi: 0x17ff, name: "Khmer" },
  { lo: 0x1800, hi: 0x18aa, name: "Traditional Mongolian" },
  { lo: 0x18b0, hi: 0x1cff, name: "minority SE-Asian & African scripts" },
  { lo: 0x1d00, hi: 0x1dff, name: "phonetic & historic extensions" },
  { lo: 0x1e00, hi: 0x1eff, name: "Latin extended additional" },
  { lo: 0x1f00, hi: 0x1fff, name: "Greek extended" },
  { lo: 0x2000, hi: 0x206f, name: "punctuation & format chars" },
  { lo: 0x2070, hi: 0x209f, name: "super/subscripts" },
  { lo: 0x20a0, hi: 0x20cf, name: "currency symbols" },
  { lo: 0x2100, hi: 0x218f, name: "letterlike & numeral forms" },
  { lo: 0x2190, hi: 0x22ff, name: "arrows & math operators" },
  { lo: 0x2300, hi: 0x23ff, name: "technical symbols" },
  { lo: 0x2400, hi: 0x243f, name: "control pictures" },
  { lo: 0x2460, hi: 0x24ff, name: "enclosed alphanumerics" },
  { lo: 0x2500, hi: 0x259f, name: "box drawing & block elements" },
  { lo: 0x25a0, hi: 0x25ff, name: "geometric shapes" },
  { lo: 0x2600, hi: 0x27bf, name: "misc symbols & dingbats" },
  { lo: 0x27c0, hi: 0x2bff, name: "math & arrow extensions" },
  { lo: 0x2c00, hi: 0x2c5f, name: "Glagolitic" },
  { lo: 0x2c60, hi: 0x2c7f, name: "Latin ext" },
  { lo: 0x2c80, hi: 0x2cff, name: "Coptic" },
  { lo: 0x2d00, hi: 0x2d2f, name: "Georgian supplement" },
  { lo: 0x2d30, hi: 0x2d7f, name: "Tifinagh" },
  { lo: 0x2d80, hi: 0x2ddf, name: "Ethiopic supplement" },
  { lo: 0x2de0, hi: 0x2dff, name: "Cyrillic ext" },
  { lo: 0x2e00, hi: 0x2e7f, name: "supplemental punctuation" },
  { lo: 0x2e80, hi: 0x2fdf, name: "CJK radicals" },
  { lo: 0x3000, hi: 0x303f, name: "CJK punctuation" },
  { lo: 0x3040, hi: 0x309f, name: "Hiragana" },
  { lo: 0x30a0, hi: 0x30ff, name: "Katakana" },
  { lo: 0x3100, hi: 0x312f, name: "Bopomofo" },
  { lo: 0x3130, hi: 0x318f, name: "Hangul compatibility jamo" },
  { lo: 0x3190, hi: 0x33ff, name: "CJK symbols & compatibility" },
  { lo: 0x3400, hi: 0x4dbf, name: "rare Han ideographs" },
  { lo: 0x4dc0, hi: 0x4dff, name: "Yijing hexagrams" },
  { lo: 0x4e00, hi: 0x9fff, name: "common Han ideographs" },
  { lo: 0xa000, hi: 0xa4cf, name: "Yi script" },
  { lo: 0xa4d0, hi: 0xabff, name: "African & minority scripts" },
  { lo: 0xac00, hi: 0xd7ff, name: "Hangul syllables" },
  { lo: 0xe000, hi: 0xf8ff, name: "BMP Private Use (Nerd Font icons)" },
  { lo: 0xf900, hi: 0xfaff, name: "rare Han variants (compatibility)" },
  { lo: 0xfb00, hi: 0xfdff, name: "presentation forms" },
  { lo: 0xfe00, hi: 0xfe0f, name: "variation selectors" },
  { lo: 0xfe10, hi: 0xfe6f, name: "vertical & small forms" },
  { lo: 0xfe70, hi: 0xfeff, name: "Arabic presentation & BOM" },
  { lo: 0xff00, hi: 0xffef, name: "fullwidth forms" },
  { lo: 0xfff0, hi: 0xfffb, name: "unassigned & interlinear annotation" },
  { lo: 0x10000, hi: 0x102ff, name: "ancient Mediterranean scripts (Linear B…)" },
  { lo: 0x10300, hi: 0x1034f, name: "Old Italic & Gothic" },
  { lo: 0x10350, hi: 0x105ff, name: "historic European scripts (Deseret, Shavian…)" },
  { lo: 0x10600, hi: 0x107ff, name: "Linear A & archaic scripts" },
  { lo: 0x10800, hi: 0x10bff, name: "ancient Near Eastern scripts" },
  { lo: 0x10c00, hi: 0x10cff, name: "Old Turkic & Old Hungarian" },
  { lo: 0x10d00, hi: 0x10fff, name: "historic Central Asian scripts" },
  { lo: 0x11000, hi: 0x11fff, name: "historic Indic scripts" },
  { lo: 0x12000, hi: 0x1247f, name: "Cuneiform (Mesopotamian)" },
  { lo: 0x12480, hi: 0x1254f, name: "Egyptian Hieroglyphs" },
  { lo: 0x12550, hi: 0x12fff, name: "ancient Near Eastern (misc)" },
  { lo: 0x13000, hi: 0x1342f, name: "Egyptian Hieroglyphs ext" },
  { lo: 0x13430, hi: 0x143ff, name: "other ancient scripts" },
  { lo: 0x14400, hi: 0x1467f, name: "Anatolian Hieroglyphs" },
  { lo: 0x14680, hi: 0x16aff, name: "historic scripts (misc)" },
  { lo: 0x16b00, hi: 0x16fff, name: "historic scripts ext" },
  { lo: 0x17000, hi: 0x18aff, name: "Tangut script" },
  { lo: 0x18b00, hi: 0x18dff, name: "Khitan script" },
  { lo: 0x18e00, hi: 0x1b2ff, name: "historic CJK-adjacent & kana ext" },
  { lo: 0x1b300, hi: 0x1bbff, name: "minority scripts ext" },
  { lo: 0x1bc00, hi: 0x1d0ff, name: "shorthand & historic ext" },
  { lo: 0x1d100, hi: 0x1d2ff, name: "musical symbols" },
  { lo: 0x1d300, hi: 0x1d37f, name: "Tai Xuan Jing & counting rods" },
  { lo: 0x1d400, hi: 0x1d7ff, name: "mathematical alphanumerics" },
  { lo: 0x1d800, hi: 0x1daaf, name: "Sutton SignWriting" },
  { lo: 0x1dab0, hi: 0x1e8ff, name: "minority scripts ext" },
  { lo: 0x1e900, hi: 0x1efff, name: "Adlam & modern African scripts" },
  { lo: 0x1f000, hi: 0x1f0ff, name: "mahjong, dominoes & playing cards" },
  { lo: 0x1f100, hi: 0x1f1ff, name: "regional indicators (flag emoji)" },
  { lo: 0x1f200, hi: 0x1f2ff, name: "enclosed ideographics" },
  { lo: 0x1f300, hi: 0x1f5ff, name: "emoji pictographs" },
  { lo: 0x1f600, hi: 0x1f64f, name: "emoticons" },
  { lo: 0x1f650, hi: 0x1f6ff, name: "dingbats & transport emoji" },
  { lo: 0x1f700, hi: 0x1f7ff, name: "alchemical & geometric ext" },
  { lo: 0x1f800, hi: 0x1f8ff, name: "arrow extensions" },
  { lo: 0x1f900, hi: 0x1f9ff, name: "emoji supplement" },
  { lo: 0x1fa00, hi: 0x1faff, name: "emoji ext-A" },
  { lo: 0x1fb00, hi: 0x1fbff, name: "legacy computing" },
  { lo: 0x20000, hi: 0x2a6df, name: "rare Han ideographs (Ext-B)" },
  { lo: 0x2a6e0, hi: 0x2ebef, name: "rare Han ideographs (Ext C–F)" },
  { lo: 0x2ebf0, hi: 0x2ee5f, name: "rare Han ideographs (Ext-I)" },
  { lo: 0x2f800, hi: 0x2fa1f, name: "Han compatibility ideographs" },
  { lo: 0x30000, hi: 0x323af, name: "very rare Han ideographs (Ext-G+)" },
  { lo: 0x323b0, hi: 0xdffff, name: "unassigned (astral)" },
  { lo: 0xe0000, hi: 0xe007f, name: "Tags (language tags, emoji sequences)" },
  { lo: 0xe0100, hi: 0xe01ef, name: "Mongolian variation selectors" },
  { lo: 0xf0000, hi: 0xffffd, name: "Supplementary Private Use-A (md- icons)" },
  { lo: 0x100000, hi: 0x10fffd, name: "Supplementary Private Use-B" },
];

function regionName(cp: number): string {
  if (isNoncharacter(cp)) return "Unicode noncharacters";
  for (const r of REGIONS) {
    if (cp >= r.lo && cp <= r.hi) return r.name;
  }
  return "unassigned";
}

function summarize(cps: number[]): string {
  if (cps.length === 0) return "";
  const counts = new Map<string, number>();
  for (const cp of cps) {
    const n = regionName(cp);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([n, c]) => (c === 1 ? n : `${n} ×${c}`));
  return parts.length <= 4 ? parts.join(", ") : parts.slice(0, 4).join(", ") + ", …";
}

const ICON_CONTEXT =
  /icon|glyph|\u56fe\u6807|\u5b57\u5f62|\u5707\u6a19|U\+[0-9A-Fa-f]{4,5}|nerd.?font|PUA|private.?use|\u79c1\u6709[\u533a\u5340]|\u96f6[\u5bbd\u5bec]|zero.?width|tag|\u6a19\u7c64|\u8b8a\u9ad4|variation|selector|\u975e\u5b57\u7b26|noncharacter|\u8f49\u7fa9|escape|unicode/i;

// Inline code-span splitting: split a line into {text, protected} segments.
// CommonMark semantics: a run of N backticks opens, an EQUAL-length run
// closes; content may contain runs of other lengths (`` `x` `` is the standard
// way to show backticked code and must be protected as a whole — the v1 regex failed exactly here).
// Unmatched runs stay literal; state never crosses lines; worst case one line. Fences first.
function splitByInlineSpans(line: string): Array<{ text: string; protected: boolean }> {
  const segs: Array<{ text: string; protected: boolean }> = [];
  let last = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let n = 0;
    while (i + n < line.length && line[i + n] === "`") n++;
    // scan forward for an equal-length closing run
    let j = i + n;
    let closed = -1;
    while (j < line.length) {
      if (line[j] === "`") {
        let m2 = 0;
        while (j + m2 < line.length && line[j + m2] === "`") m2++;
        if (m2 === n) {
          closed = j + m2;
          break;
        }
        j += m2; // different length: content, skip the whole run
      } else {
        j++;
      }
    }
    if (closed !== -1) {
      if (i > last) segs.push({ text: line.slice(last, i), protected: false });
      segs.push({ text: line.slice(i, closed), protected: true });
      last = closed;
      i = closed;
    } else {
      i += n; // unmatched: literal, move on
    }
  }
  if (last < line.length) segs.push({ text: line.slice(last), protected: false });
  return segs.length > 0 ? segs : [{ text: line, protected: false }];
}

// Traces → placeholder filling (returns replaced text and fill count)
function tofuFill(text: string): { text: string; filled: number; cps: number[] } {
  // Evidence-only fill layer (observation tier, never guesses):
  //   - empty quote/backtick pairs are NOT rewritten (2026-10-28 review): a
  //     legit "" and a channel-dropped PUA char between quotes produce
  //     IDENTICAL text — undecidable in principle; the escape protocol and
  //     [[nf:]] markers carry real codepoints, guessing from fragments is
  //     what this project refuses to do
  //   - Lua-style codepoint comments (-- U+E235) DO carry a concrete
  //     codepoint: fill a trailing box, but only OUTSIDE fences/inline code
  let filled = 0;
  const cps: number[] = [];
  const LUALINE = /(--[ \t]*U\+[0-9A-Fa-f]{4,6})[ \t]*\r?$/; // 4-6 hex (PUA-B needs 6); \r? = CRLF tolerance
  text = walkUnprotected(text, (seg) =>
    seg.replace(LUALINE, (m) => {
      const hex = /U\+([0-9A-Fa-f]{4,6})/.exec(m);
      const cp = hex ? parseInt(hex[1], 16) : null;
      if (cp === null || cp > 0x10ffff) return m; // beyond the codespace: not our trace
      if (!isAtRisk(cp)) return m; // e.g. U+0041 'A': a safe codepoint, nothing was dropped
      // Compliance check scoped to THIS segment: an already-restored escape
      // on the same line means nothing was lost here — and so does a visible
      // substitution marker (□U+XXXX): the escape ARRIVED, only the font
      // state was unknown/missing; that is not a model drop and must not be
      // filled or reported twice (review round 12). Searching the whole
      // message, round 11 taught us, silences genuine traces elsewhere.
      const marker = visibleMarker(cp);
      if (seg.includes(String.fromCodePoint(cp)) || seg.includes(marker)) return m;
      filled++;
      cps.push(cp);
      // Keep the box inside the line: in CRLF text the trailing \r belongs
      // after the marker, otherwise the box lands at the head of the next line
      const cr = m.endsWith("\r") ? "\r" : "";
      return m.slice(0, m.length - cr.length) + " " + TOFU + cr;
    }),
  );
  return { text, filled, cps };
}

// Local Nerd Font glyph lookup script (no backslashes/backticks — dodges template-literal escaping hell)
// starship per-module defaults (from starship print-config --default, 1.26.0;
// regenerate by rerunning that command — notes at the file tail)
const STARSHIP_DEFAULTS_RAW = "aws.symbol=2601,fe0f|azure.symbol=f0805|battery.full_symbol=f0079|battery.charging_symbol=f0084|battery.discharging_symbol=f0083|battery.unknown_symbol=f0091|battery.empty_symbol=f008e|buf.symbol=1f403|bun.symbol=1f95f|character.success_symbol=5b,276f,5d,28,62,6f,6c,64,67,72,65,65,6e,29|character.error_symbol=5b,276f,5d,28,62,6f,6c,64,72,65,64,29|character.vimcmd_symbol=5b,276e,5d,28,62,6f,6c,64,67,72,65,65,6e,29|character.vimcmd_visual_symbol=5b,276e,5d,28,62,6f,6c,64,79,65,6c,6c,6f,77,29|character.vimcmd_replace_symbol=5b,276e,5d,28,62,6f,6c,64,70,75,72,70,6c,65,29|character.vimcmd_replace_one_symbol=5b,276e,5d,28,62,6f,6c,64,70,75,72,70,6c,65,29|claude_context.gauge_full_symbol=2588|claude_context.gauge_partial_symbol=2592|claude_context.gauge_empty_symbol=2591|claude_cost.symbol=1f4b0|claude_model.symbol=1f916|cmake.symbol=25b3|cobol.symbol=2699,fe0f|conda.symbol=1f152|container.symbol=2b22|crystal.symbol=1f52e|daml.symbol=39b|dart.symbol=1f3af|deno.symbol=1f995|docker_context.symbol=1f433|elixir.symbol=1f4a7|elm.symbol=1f333|erlang.symbol=e7b1|fennel.symbol=1f9c5|fortran.symbol=1f175|fossil_branch.symbol=e0a0|fossil_branch.truncation_symbol=2026|gcloud.symbol=2601,fe0f|git_branch.symbol=e0a0|git_branch.truncation_symbol=2026|git_commit.tag_symbol=1f3f7|gleam.symbol=2b50|golang.symbol=1f439|gradle.symbol=1f176|guix_shell.symbol=1f403|haskell.symbol=3bb|haxe.symbol=2318|helm.symbol=2388|hg_branch.symbol=e0a0|hg_branch.truncation_symbol=2026|hostname.ssh_symbol=1f310|java.symbol=2615|jobs.symbol=2726|julia.symbol=b83|kotlin.symbol=1f17a|kubernetes.symbol=2638|lua.symbol=1f319|maven.symbol=1f17c|memory_usage.symbol=1f40f|meson.truncation_symbol=2026|meson.symbol=2b22|mojo.symbol=1f525|nats.symbol=2709,fe0f|netns.symbol=1f6dc|nim.symbol=1f451|nix_shell.symbol=2744,fe0f|nodejs.symbol=e718|ocaml.symbol=1f42b|odin.symbol=d8|opa.symbol=1fa96|openstack.symbol=2601,fe0f|package.symbol=1f4e6|perl.symbol=1f42a|php.symbol=1f418|pijul_channel.symbol=e0a0|pijul_channel.truncation_symbol=2026|pixi.symbol=1f9da|pulumi.symbol=f1b2|python.symbol=1f40d|quarto.symbol=2a01|raku.symbol=1f98b|red.symbol=1f53a|rlang.symbol=1f4d0|ruby.symbol=1f48e|rust.symbol=1f980|scala.symbol=1f182|shlvl.symbol=2195,fe0f|spack.symbol=1f162|status.symbol=274c|status.not_executable_symbol=1f6ab|status.not_found_symbol=1f50d|status.sigint_symbol=1f9f1|status.signal_symbol=26a1|sudo.symbol=1f9d9|swift.symbol=1f426|terraform.symbol=1f4a0|vagrant.symbol=2371|xmake.symbol=25b3|zig.symbol=21af";

// Local Nerd Font glyph + starship default lookup (no backslashes/backticks)
const NF_LOOKUP_PY = `
import sys, os, glob, shutil, subprocess
query = sys.argv[1].strip()
limit = max(1, min(100, int(sys.argv[2]))) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 20

def font_files(root):
    root = os.path.abspath(os.path.expanduser(root))
    if os.path.isdir(root):
        return glob.glob(os.path.join(root, "**", "*"), recursive=True)
    return [root]

def discover_fonts():
    explicit = os.environ.get("PI_NF_FONT_PATHS", "").strip()
    if explicit:
        found = []
        for item in explicit.split(os.pathsep):
            if item.strip():
                found += font_files(item.strip())
        return found, "explicit"
    if sys.platform.startswith("linux") and shutil.which("fc-match"):
        try:
            out = subprocess.check_output(
                ["fc-match", "-s", "--format=%{file}\\n", "monospace"],
                text=True, timeout=15)
            return [p for p in out.splitlines() if p], "fontconfig-monospace"
        except Exception:
            pass
    return [], "unconfigured"

fonts, font_source = discover_fonts()
fonts = sorted(set(f for f in fonts if os.path.isfile(f) and f.lower().endswith((".ttf", ".ttc", ".otf"))))
all_names = {}
icons = []

def icon_cp(cp):
    return 0xE000 <= cp <= 0xF8FF or 0xF0000 <= cp <= 0xFFFFD or 0x100000 <= cp <= 0x10FFFD

if fonts:
    try:
        from fontTools.ttLib import TTCollection, TTFont
        seen_icons = set()
        for path in fonts:
            try:
                if path.lower().endswith(".ttc"):
                    # shared file handle: close the collection, never a single face
                    coll = TTCollection(path, lazy=True)
                    try:
                        faces = list(coll.fonts)
                        for face in faces:
                            for cp, nm in (face.getBestCmap() or {}).items():
                                all_names.setdefault(cp, set()).add(nm)
                                if icon_cp(cp) and (cp, nm) not in seen_icons:
                                    icons.append((cp, nm))
                                    seen_icons.add((cp, nm))
                    finally:
                        coll.close()
                else:
                    face = TTFont(path, lazy=True)
                    try:
                        for cp, nm in (face.getBestCmap() or {}).items():
                            all_names.setdefault(cp, set()).add(nm)
                            if icon_cp(cp) and (cp, nm) not in seen_icons:
                                icons.append((cp, nm))
                                seen_icons.add((cp, nm))
                    finally:
                        face.close()
            except Exception:
                pass
    except ImportError:
        pass
bs = chr(92)
def esc(cp):
    return bs + "u%04x" % cp if cp <= 0xFFFF else bs + "u{%x}" % cp
q = query.lower()
# One family ranking for every path (starship rows, name_for, keyword rows).
# Prefix match after stripping a leading "nf-" — substring matching would rank
# a name like "nf-md-dev-python" by whichever family appears first AND silently
# disagreed with the second copy that used to shadow this one (review round 16).
FAM = ("pl", "linux", "fae", "fa", "oct", "md", "seti", "dev", "cod", "custom", "ie", "weather")
def famrank(nm):
    n = nm.lower()
    if n.startswith("nf-"):
        n = n[3:]
    for i, p in enumerate(FAM):
        if n.startswith(p + "-"):
            return i
    return len(FAM)
def name_for(cp):
    vals = all_names.get(cp) or []
    return min(vals, key=lambda nm: (famrank(nm), nm)) if vals else None

# starship defaults mode: query is starship / starship <module>
if q == "starship" or q.startswith("starship:") or q.startswith("starship "):
    kw = q[9:].strip() if len(q) > 8 else ""
    table = os.environ.get("NF_STARSHIP", "")
    ents = []
    for item in table.split("|"):
        if not item:
            continue
        k, _, v = item.partition("=")
        if kw and kw not in k:
            continue
        ents.append((k, v))
    print("nerdfont_lookup [starship defaults]: %d entries%s" % (len(ents), (" for '" + kw + "'") if kw else ""))
    shown = 0
    for k, v in ents:
        if shown >= limit:
            print("... and %d more (increase limit)" % (len(ents) - limit))
            break
        parts = []
        for h in v.split(","):
            if not h:
                continue
            cp = int(h, 16)
            parts.append("U+%04X %s %s" % (cp, esc(cp), name_for(cp) or "(no glyph in terminal font chain)"))
        print("%-28s %s" % (k, "  ".join(parts)))
        shown += 1
    if not ents:
        print("(no module matched; try: starship nodejs / starship git_branch / starship)")
    sys.exit(0)

if not fonts:
    print("No active terminal font chain found; set PI_NF_FONT_PATHS to the terminal font and fallback files")
    sys.exit(0)
if not all_names:
    print("fontTools not installed (pip3 install fonttools)")
    sys.exit(0)
# resolve mode: the [[nf:name]] resolution end. Comma-separated names; hex or ? per name
if q.startswith("resolve:"):
    # Stable semantic aliases: common human/model names → font-internal names (alias → exact → substring)
    ALIAS = {"git-branch": "branch", "node-js": "nodejs", "node.js": "nodejs", "macos": "apple"}
    for name in q[8:].split(","):
        name = name.strip().lower()
        if not name:
            continue
        target = ALIAS.get(name, name)
        cands = [(famrank(nm), cp) for cp, nm in icons if nm.lower() == target]
        if not cands:
            cands = [(famrank(nm), cp) for cp, nm in icons if target in nm.lower()]
        if cands:
            print("%s %x" % (name, min(cands)[1]))
            continue
        # The name may exist in the font chain as an ordinary (non-PUA) glyph.
        # Reporting "no such name" there would be false; report it precisely so
        # the client can say "resolves to U+XXXX, not an icon codepoint".
        plain = [(famrank(nm), cp) for cp, vals in all_names.items() for nm in vals if nm.lower() == target]
        if not plain:
            plain = [(famrank(nm), cp) for cp, vals in all_names.items() for nm in vals if target in nm.lower()]
        if plain:
            print("%s ~%x" % (name, min(plain)[1]))
        else:
            print("%s ?" % name)
    sys.exit(0)
direct = None
if q.startswith("u+") and len(q) in (6, 7, 8) and all(c in "0123456789abcdef" for c in q[2:]):
    direct = int(q[2:], 16)
rows, seen = [], set()
source_rows = ((cp, nm) for cp, vals in all_names.items() for nm in vals) if direct is not None else iter(icons)
for cp, name in source_rows:
    if (cp, name) in seen:
        continue
    seen.add((cp, name))
    if direct is not None:
        if cp == direct:
            rows.append((cp, name))
    elif q in name.lower():
        rows.append((cp, name))

# ascending codepoint within a family (famrank defined once, above)
rows.sort(key=lambda r: (famrank(r[1]), r[0]))

mode = ("codepoint " if direct is not None else "keyword ") + query
print("nerdfont_lookup: %d terminal-chain font file(s) via %s, %d match(es) for %s" % (len(fonts), font_source, len(rows), mode))
for cp, name in rows[:limit]:
    print("U+%04X  %-34s escape: %-12s" % (cp, name, esc(cp)))
if len(rows) > limit:
    print("... and %d more (increase limit)" % (len(rows) - limit))
if not rows:
    print("(no match; try keywords: python, vim, arch, branch, docker, nodejs, aws; or 'starship <module>')")
`;
// Monospace grid renderer: column-width arithmetic + frames + dot leaders + escaped preview + optional real-char file write
const RENDER_PY = `
import sys, unicodedata
content = sys.stdin.read()
argv = sys.argv[1:]
width = int(argv[0]) if len(argv) > 0 and argv[0].isdigit() else None
frame = argv[1] if len(argv) > 1 else "none"
path = argv[2] if len(argv) > 2 and argv[2] else ""
BS = chr(92)
HEX = "0123456789abcdefABCDEF"

def unesc(s):
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == BS and i + 1 < n and s[i+1] == "u":
            j = i + 2
            if j < n and s[j] == "{":
                k = s.find("}", j)
                if k != -1 and 0 < k - j - 1 <= 6 and all(c in HEX for c in s[j+1:k]):
                    v = int(s[j+1:k], 16)
                    out.append(chr(v) if v <= 0x10FFFF else "[U+%X]" % v)  # beyond the codespace: visible marker, not a crash
                    i = k + 1
                    continue
            else:
                h = s[j:j+4]
                if len(h) == 4 and all(c in HEX for c in h):
                    out.append(chr(int(h, 16)))
                    i = j + 4
                    continue
        out.append(s[i])
        i += 1
    return "".join(out)

def dw(s):
    total = 0
    cluster = 0
    joined = False
    for ch in s:
        o = ord(ch)
        if o == 0x200D:
            joined = True
            continue
        if o == 0xFE0F:
            cluster = max(cluster, 2)  # emoji presentation upgrades a narrow base
            continue
        if unicodedata.combining(ch) or unicodedata.category(ch) in ("Cf", "Mn", "Me") or 0x1F3FB <= o <= 0x1F3FF:
            continue
        width = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if joined:
            cluster = max(cluster, width)  # a terminal renders a ZWJ emoji sequence as one cluster
            joined = False
        else:
            total += cluster
            cluster = width
    return total + cluster

def to_prev(s):
    r = []
    for c in s:
        o = ord(c)
        if 0xE000 <= o <= 0xF8FF:
            r.append(BS + "u%04X" % o)
        elif 0xF0000 <= o <= 0x10FFFD:
            r.append(BS + "u{%X}" % o)  # supplementary PUA must also surface as an escape literal (channel-safe)
        else:
            r.append(c)
    return "".join(r)

src = [unesc(l[:-1] if l.endswith("\\r") else l) for l in content.split("\\n")]

def split_leader(l):
    # Split on the LAST tab and neutralise any others: a raw tab left in the
    # output row breaks terminal alignment (round 20). "a<TAB>b<TAB>c" becomes
    # left="a b", right="c" — deterministic, no stray tabs.
    a, _, b = l.rpartition("\t")
    return a.replace("\t", " "), b.replace("\t", " ")

def lw(l):
    if "\t" in l:
        a, b = split_leader(l)
        return dw(a) + dw(b) + 2
    return dw(l)

is_rule = lambda l: l.strip() in ("-", "=")
body = [l for l in src if not is_rule(l)]
W = width if width is not None else max((lw(l) for l in body), default=0)

if frame == "double":
    SIDE, TL, ML, BL, TR, MR, BR = "\u2551", "\u2554", "\u2560", "\u255a", "\u2557", "\u2563", "\u255d"
    HR = {"-": "\u2500", "=": "\u2550"}
else:
    SIDE, TL, ML, BL, TR, MR, BR = "|", "+", "+", "+", "+", "+", "+"
    HR = {"-": "-", "=": "="}

warns = []
if BS + "t" in content:
    warns.insert(0, "content contains a literal backslash-t; dot-leader rows need a REAL tab character"),
rule_total = sum(1 for l in src if is_rule(l))
synth_top = frame != "none" and (not src or not is_rule(src[0]))
synth_bottom = frame != "none" and (not src or not is_rule(src[-1]))
rule_seen = 0
rows = []
for l in src:
    if is_rule(l):
        rule_seen += 1
        if frame == "none":
            continue
        eff = rule_seen + (1 if synth_top else 0)
        tot = rule_total + (1 if synth_top else 0) + (1 if synth_bottom else 0)
        if eff == 1:
            lc, rc = TL, TR
        elif eff == tot:
            lc, rc = BL, BR
        else:
            lc, rc = ML, MR
        rows.append(lc + HR[l.strip()] * W + rc)
        continue
    if "\t" in l:
        a, b = split_leader(l)
        gap = W - dw(a) - dw(b) - 2
        if gap < 3:
            warns.append("dot-leader row too tight (%d cols): %s ... %s" % (gap, a[:20], b[:20]))
            gap = max(gap, 0)
        inner = a + " " + "." * gap + " " + b
        pad = W - dw(a) - dw(b) - 2 - gap
        if pad > 0:
            inner = inner + " " * pad
        rows.append((SIDE + inner + SIDE) if frame != "none" else inner)
        continue
    w = dw(l)
    if w > W:
        warns.append("line %d overflows: %d > %d cols: %s" % (len(rows) + 1, w, W, l[:30]))
    row = l + " " * max(0, W - w)
    rows.append((SIDE + row + SIDE) if frame != "none" else row)

if synth_top:
    rows.insert(0, TL + HR["="] * W + TR)
if synth_bottom:
    rows.append(BL + HR["="] * W + BR)
pua = sum(1 for l in src for c in l if 0xE000 <= ord(c) <= 0xF8FF or 0xF0000 <= ord(c) <= 0x10FFFD)
print("[render_preview] frame=%s width=%d rows=%d pua=%d" % (frame, W, len(rows), pua))
for r in rows:
    print(to_prev(r))
if warns:
    print("--- WARNINGS (%d):" % len(warns))
    for w in warns:
        print("  ! " + w)
else:
    print("--- width audit: all rows = %d cols" % W)
print("--- tip: copy the preview lines above VERBATIM into your reply; " + BS + "uXXXX escapes render as real glyphs client-side")
if path:
    try:
        data = "\\n".join(rows) + "\\n"
        open(path, "w", encoding="utf-8").write(data)
        print("--- written: %s (%d bytes, real chars)" % (path, len(data.encode("utf-8"))))
    except Exception as e:
        print("--- write FAILED: %s" % e)
`;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_e, ctx) => {
    ensureCmapCache(ctx?.ui?.notify?.bind(ctx.ui));
  });

  // (4) Codepoint oracle: an authoritative source (local Nerd Font cmaps) so
  //     the model never guesses codepoints from memory or scans the filesystem
  //     (measured cost of one such episode: 60k thinking chars + full-disk scan + 10 min + ~$0.32)
  pi.registerTool({
    name: "nerdfont_lookup",
    label: "Nerd Font Lookup",
    description:
      "Look up Nerd Font glyphs installed on this machine, or starship default symbols. " +
      "Glyph mode: keyword (python, docker, nodejs, md-nodejs, ...) or codepoint (U+E235); " +
      "results are family-prioritized (pl-/linux-/fae-/fa-/oct-/md- first) so conventional glyphs rank first. " +
      "Starship mode: query 'starship <module>' (e.g. starship nodejs) returns the module default symbol(s) " +
      "with codepoints and ready-to-paste ASCII escapes (\\uXXXX / \\u{xxxxx}) — no need to fetch upstream sources. " +
      "Authoritative: parsed from local font cmaps + baked starship print-config. " +
      "Prefer this tool over guessing codepoints or writing your own scanning scripts.",
    parameters: Type.Object({
      query: Type.String({ description: "glyph name keyword, or U+XXXX codepoint" }),
      limit: Type.Optional(Type.Number({ description: "max rows to return (default 20)", minimum: 1, maximum: 100, multipleOf: 1 })),
    }),
    async execute(_toolCallId, params) {
      const out = await new Promise<string>((resolve) => {
        execFile(
          "python3",
          ["-c", NF_LOOKUP_PY, String(params.query), String(params.limit ?? 20)],
          { timeout: 20000, maxBuffer: 1 << 20, env: { ...process.env, NF_STARSHIP: STARSHIP_DEFAULTS_RAW } },
          (err, stdout, stderr) =>
            resolve(err ? `ERROR: failed — ${processErrorSummary(err, stderr)}` : stdout),
        );
      });
      return { content: [{ type: "text", text: out }], details: {} };
    },
  });

  // (5) Monospace layout renderer: width arithmetic (CJK=2 cols, PUA=1) + frames
  //     + dot leaders + channel-safe escaped preview + optional real-char file write
  //     (bypasses the output-channel strip; no more hand-rolled alignment scripts)
  pi.registerTool({
    name: "render_preview",
    label: "Render Preview",
    description:
      "Render monospace-grid layouts (posters, status bars, boxed tables) with wcwidth-style width " +
      "arithmetic: CJK/fullwidth = 2 columns, PUA icons = 1. Content lines support \\uXXXX escapes; " +
      "a line of just '-' or '=' becomes a horizontal rule; a line containing a tab becomes a " +
      "dot-leader row (leftpart<TAB>rightpart). frame: none|ascii|double adds box borders. " +
      "Returns the aligned preview with PUA shown as \\uXXXX literals (channel-safe) plus a width audit; " +
      "writePath additionally writes the real-character version to a file, bypassing the output-channel strip. " +
      "Use this instead of hand-writing alignment scripts in bash.",
    parameters: Type.Object({
      content: Type.String({ description: "layout lines; \\uXXXX escapes OK; '-'/'=' rule lines; tab = dot-leader row" }),
      width: Type.Optional(Type.Number({ description: "target inner width in columns (default: widest line)", minimum: 1, maximum: 10000, multipleOf: 1 })),
      frame: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("ascii"), Type.Literal("double")], { description: "box frame style (default none)" })),
      writePath: Type.Optional(Type.String({ description: "also write the real-char version to this file" })),
    }),
    async execute(_toolCallId, params) {
      if (params.width !== undefined && (!Number.isInteger(params.width) || params.width < 1 || params.width > 10000)) {
        return { content: [{ type: "text", text: "ERROR: width must be an integer from 1 to 10000" }], details: {} };
      }
      if (params.frame !== undefined && !["none", "ascii", "double"].includes(params.frame)) {
        return { content: [{ type: "text", text: "ERROR: frame must be none, ascii, or double" }], details: {} };
      }
      // writePath safety: only cwd and the system tmp by default; PI_RENDER_ALLOW_ANY=1 lifts it
      if (params.writePath && process.env.PI_RENDER_ALLOW_ANY !== "1") {
        const pathMod = require("node:path");
        const fsMod = require("node:fs");
        const wp = params.writePath;
        const tilde = wp.startsWith("~") ? os.homedir() + wp.slice(1) : wp;
        const abs = pathMod.isAbsolute(tilde) ? tilde : pathMod.resolve(tilde);
        // Realpath containment: resolve symlinks first (/tmp/x → /dev/null must not slip through)
        const realAbs = fsMod.existsSync(abs)
          ? fsMod.realpathSync(abs)
          : pathMod.join(fsMod.realpathSync(pathMod.dirname(abs)), pathMod.basename(abs));
        const inside = (root: string) => {
          const rr = fsMod.realpathSync(root);
          return realAbs === rr || realAbs.startsWith(rr + pathMod.sep);
        };
        const cwd = process.cwd();
        const tmp = os.tmpdir();
        if (!inside(cwd) && !inside(tmp)) {
          return {
            content: [{ type: "text", text: `ERROR: writePath must be inside cwd (${cwd}) or tmp (${tmp}); got ${realAbs}. Set PI_RENDER_ALLOW_ANY=1 to lift this guard.` }],
            details: {},
          };
        }
      }
      const out = await new Promise<string>((resolve) => {
        const child = execFile(
          "python3",
          ["-c", RENDER_PY, String(params.width ?? ""), params.frame ?? "none", params.writePath ?? ""],
          { timeout: 20000, maxBuffer: 1 << 22 },
          (err, stdout, stderr) =>
            resolve(err ? `ERROR: failed — ${processErrorSummary(err, stderr)}` : stdout),
        ) as any;
        child.stdin?.on("error", () => {});
        child.stdin?.end(params.content ?? "");
      });
      return { content: [{ type: "text", text: out }], details: {} };
    },
  });

  // Hole 3 | stream-loss detection: snapshot at-risk codepoints during message_update;
  // if one vanishes from the final text, the strip happened beyond the parser.
  // Upstream stripping (already gone in stream events) leaves the snapshot empty; this idles for free.
  const streamSeenCps = new Set<number>();
  let streamTracking = false;

  pi.on("message_start", async () => {
    streamSeenCps.clear();
    streamTracking = false;
  });

  pi.on("message_update", async (event) => {
    const msg = (event as any).message;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;
    const texts = msg.content
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n");
    if (texts.length > 200_000) return;
    if (texts.length > 0) streamTracking = true;
    for (const ch of texts) {
      const cp = ch.codePointAt(0)!;
      if (isAtRisk(cp)) streamSeenCps.add(cp); // narrowed: emoji/plain-astral edits are not transit loss
    }
  });

  // Inject the output protocol into the system prompt (every turn).
  // Idempotent: a prompt that already carries the block is left alone — pi may
  // fire this hook more than once (relay/compaction/chained extensions) and a
  // doubled protocol wastes context and repeats instructions (round 17).
  pi.on("before_agent_start", async (event) => {
    if ((event.systemPrompt ?? "").includes(PROTOCOL_TITLE)) return;
    return {
      systemPrompt:
        (event.systemPrompt ?? "") +
        `

${PROTOCOL_TITLE}
Your output channel silently drops BMP Private Use characters (U+E000–
U+F8FF; every Nerd Font dev-/seti-/cod-/fa-/oct-/custom-/linux- icon lives
there — empirically always dropped). The supplementary PUA planes
(U+F0000–U+FFFFD, U+100000–U+10FFFD, the md- icons), the Tags block
(U+E0000–U+E007F), and noncharacters (U+FDD0–U+FDEF, U+xFFFE/U+FFFF
on any plane) pass the channel, but you cannot emit them reliably either —
write ALL of them as ASCII escapes: \\uXXXX or \\u{xxxx} (e.g. the python
icon as \\uE235, md- icons as \\u{f031f}). The nerdfont-unescape extension
restores them to real characters when the message lands (rendered as
icons in the terminal). Ordinary text (CJK, emoji, zero-width chars,
variation selectors) is unaffected — write those as-is.
When looking up or verifying codepoints, prefer the nerdfont_lookup tool
(local Nerd Font glyphs and codepoints, returns paste-ready escapes); starship defaults via "starship <module>" (baked in, no network).
Never guess codepoints from memory and never write scanning scripts.
Unassigned codepoints are dropped too — always escape them (a tofu box in the terminal after restoration is expected).
To show an escape literally, write a double backslash \\uXXXX — the client will not restore it.
Even simpler: write [[nf:name]] semantic markers (e.g. [[nf:python]], [[nf:git-branch]]);
the client resolves them against local fonts and renders icons. Unsure about a name? Query nerdfont_lookup first.
Markers and escapes inside code spans or fences are never touched.`
    };
  });

  // Hole 1 | input-side protection: at-risk chars in user messages are stripped by the channel
  // (the model never receives them). Auto-replace with \uXXXX escapes (protocol-native, model-readable) and tell the user.
  pi.on("input", async (event, ctx) => {
    let text = event.text;
    // Defensive: a non-string payload must never block the user's input
    // (self-review round 14 — used to throw "text is not iterable")
    if (typeof text !== "string") return { action: "continue" };
    const escaped: number[] = [];
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (isAtRisk(cp)) {
        escaped.push(cp);
        out += cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, "0")}` : `\\u{${cp.toString(16)}}`;
      } else {
        out += ch;
      }
    }
    if (escaped.length === 0) return { action: "continue" };
    ctx.ui.notify(
      `⇠ ${escaped.length} icon/at-risk char${escaped.length === 1 ? "" : "s"} in your message would be stripped by the channel — auto-escaped to \\uXXXX (${summarize(escaped)}); the model receives the escapes`,
      "warning",
    );
    return { action: "transform", text: out };
  });

  pi.on("message_end", async (event, ctx) => {
    const msg = event.message as any;
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return;
    if (emittedTexts().includes(joinBlocks(msg.content))) return; // already ours: never process our own output twice

    let restored = 0;
    let filled = 0;
    const restoredCps: number[] = [];
    const substitutedCps: number[] = [];
    const fillCps: number[] = [];
    let hatched = 0;
    let contentChanged = false;

    const content = [];
    for (const block of msg.content as any[]) {
      if (block?.type !== "text" || typeof block.text !== "string") {
        content.push(block);
        continue;
      }
      const marked = await resolveNfMarkers(block.text, ctx?.ui?.notify?.bind(ctx.ui)); // (0) semantic markers → escapes
      const u = unescapeAtRisk(marked); // (1) restore escapes
      let text = u.text;
      restored += u.restored;
      restoredCps.push(...u.cps);
      substitutedCps.push(...u.substituted);
      hatched += u.hatched;
      if (ICON_CONTEXT.test(text)) {
        // (2) trace filling (icon-context gated, keeps false positives down)
        const r = tofuFill(text);
        if (r.filled > 0) {
          text = r.text;
          filled += r.filled;
          fillCps.push(...r.cps);
        }
      }
      if (text === block.text) content.push(block);
      else {
        contentChanged = true;
        content.push({ ...block, text });
      }
    }

    // Hole 3: an at-risk codepoint from the stream snapshot missing in the final text → strip evidence
    if (streamTracking && streamSeenCps.size > 0) {
      // Compare the POST-conversion text: a raw char in the stream plus a
      // restored escape in the final message are one character in two shapes — reporting MISSING and restored together is a contradiction (review precedent)
      const finalText = (content as any[])
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      const dropped = [...streamSeenCps].filter(
        (cp) => !finalText.includes(String.fromCodePoint(cp)) && !finalText.includes(visibleMarker(cp)),
      );
      if (dropped.length > 0) {
        ctx.ui.notify(
          `⚠ ${dropped.length} char${dropped.length === 1 ? "" : "s"} seen in the stream but MISSING in the final message — stripped in transit: ${summarize(dropped)}`,
          "warning",
        );
      }
      streamSeenCps.clear();
      streamTracking = false;
    }

    // Hatch-only rewrites must still land (double → single backslash display);
    // review precedent: hatched went uncounted once and this return dropped the rewrite (a real fake-green)
    if (restored === 0 && filled === 0 && substitutedCps.length === 0) {
      if (hatched > 0 || contentChanged) {
        const out = { message: { ...msg, content } }; // carry every mapped rewrite
        pushedEmitted(joinBlocks(content));
        return out;
      }
      return;
    }

    pushedEmitted(joinBlocks(content));

    // (3) Reporting: the problem first (what was lost, which region), then the
    //    action (□ fill / restored), then advice; regions get semantic names
    const restoredRegions = summarize(restoredCps);
    const restoredPart =
      restored > 0
        ? `${restored} char${restored === 1 ? "" : "s"} restored from \\uXXXX escapes${restoredRegions ? ` — ${restoredRegions}` : ""}`
        : "";
    const substPart =
      substitutedCps.length > 0
        ? `${substitutedCps.length} char${substitutedCps.length === 1 ? "" : "s"} with no renderable glyph shown as ${TOFU}U+XXXX — ${summarize(substitutedCps)}`
        : "";
    if (filled > 0) {
      const dropEntries: string[] = [];
      const known = summarize(fillCps);
      if (known) dropEntries.push(known);
      let warn = `⚠ ${filled} char${filled === 1 ? "" : "s"} likely dropped by the model — now shown as ${TOFU} placeholders (drop regions: ${dropEntries.join(", ")})`;
      if (restoredPart) warn += `; ${restoredPart}`;
      warn += ". Ask it to resend with \\uXXXX escapes to recover them";
      if (substPart) warn += `; ${substPart}`;
      ctx.ui.notify(warn, "warning");
    } else if (substPart) {
      ctx.ui.notify(`◈ ${substPart}${restoredPart ? `; ${restoredPart}` : ""}`, "info");
    } else {
      ctx.ui.notify(`↻ ${restoredPart}`, "info");
    }
    return { message: { ...msg, content } };
  });
}

/*
 * Refresh ASSIGNED_BMP_RAW when Unicode advances (yearly);
 *   python3 - <<'P'
 *   import unicodedata
 *   rs, s = [], None
 *   for cp in range(0x10000):
 *       ok = unicodedata.category(chr(cp)) not in ('Cn', 'Cs')
 *       if ok and s is None: s = cp
 *       elif not ok and s is not None: rs.append((s, cp - 1)); s = None
 *   if s is not None: rs.append((s, 0xFFFF))
 *   print(','.join('%x-%x' % r for r in rs))
 *   P
 * Replace the ASSIGNED_BMP_RAW string with the output (table generated on Unicode 16.0.0).
 */
