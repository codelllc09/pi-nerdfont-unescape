// nerdfont-unescape — 补回/显形模型输出通道丢失的 BMP 私有区字符
// ────────────────────────────────────────────────────────────
// 背景：模型输出通道会静默删除 BMP 私有区字符（U+E000–U+F8FF，
// Nerd Font 的 dev-/seti-/cod-/fa-/oct-/custom-/linux- 系图标全在此区）。
// 2026-09 全量扫描（3310 探针 × 双向交叉验证）实证：该区原字符通道必丢
// （输入/输出两方向均剥离）；其余区域——PUA-A/B、Tags、非字符、astral
// 未分配、CJK 扩展 G+——通道均放行，但模型盲发（无上下文参照时）
// 保真度极低（PUA 区 0/3 精确、astral 邻位偏差率约 28%），故一并纳入
// 转义协议。被丢字符在 transcript 中整段移除、无任何占位痕迹——
// 无痕位置物理上无法事后补回。
//
// 三道防线（单个 message_end handler 依序执行）：
//   ① 转义还原：把 \uXXXX / \u{xxxx}（限实测会被丢弃的码位集）还原为真字符
//      （String.fromCodePoint 纯客户端操作，字节永不丢失）
//   ② 痕迹补框：模型违约时字符虽无痕，但常留结构性痕迹——
//      空引号对 ''、空反引号 `` ``、码位注释行尾——就地补 □（U+25A1
//      缺失字符框），让丢失位置一眼可见；图标上下文关联压误报
//   ③ 告警：如实播报——转义还原成功时 info 提示还原数量；痕迹补框
//      发生时 warn 说明占位数并建议转义重发（补框可能误报，需区分）

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";

const TOFU = "\u25A1"; // □ 缺失字符框

// BMP 已分配区间表：由本机 Python unicodedata 生成（Unicode 16.0.0）。
// BMP 未分配码位实测会被通道丢弃（U+0378），故纳入还原范围；
// astral 未分配实测可通过通道，不纳入。更新方法见文件尾注释。
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
// 实测会被模型输出通道丢弃的码位集合（与字体能否渲染无关）
function isAtRisk(cp: number): boolean {
  return (
    (cp <= 0xffff && !isAssignedBmp(cp)) || // BMP 未分配（实测亦被丢）
    (cp >= 0xe000 && cp <= 0xf8ff) || // BMP 私有区（Nerd Font 主力区）
    (cp >= 0xf0000 && cp <= 0xffffd) || // PUA-A（md- 系图标）
    (cp >= 0x100000 && cp <= 0x10fffd) || // PUA-B（Plane 15/16）
    (cp >= 0xe0000 && cp <= 0xe007f) || // Tags 区
    (cp >= 0xfdd0 && cp <= 0xfdef) || // 非字符
    (cp & 0xfffe) === 0xfffe // 各平面 U+xFFFE / U+FFFF
  );
}

/** 天生不可见：这些码位在任何字体里都不会有字形（Unicode 禁止赋予），
 * 还原成真字符等于制造新的静默失败——替换为可见标记 □U+XXXX */
function isInherentlyInvisible(cp: number): boolean {
  return (
    (cp >= 0xfdd0 && cp <= 0xfdef) || // 非字符
    (cp & 0xfffe) === 0xfffe || // 各平面 U+xFFFE / U+FFFF
    (cp >= 0xe0000 && cp <= 0xe007f) || // Tags 区（格式字符，设计上不可见）
    (cp <= 0xffff && !isAssignedBmp(cp)) // BMP 未分配（字体无字形，可能渲染空白）
  );
}

// ── 本机字体字形 ground truth ──────────────────────────────
// 类别判定只覆盖"任何字体都不可能有字形"的码位；PUA 等可能有字形的码位
// 是否真的有，由本机全部字体 cmap 的并集说了算（终端回退链也在这并集内）。
// 并集扫描一次（所有字体，不只 Nerd Font），结果缓存到磁盘，进程内复用。
import * as os from "node:os";

const CMAP_CACHE =
  process.platform === "win32"
    ? `${process.env.LOCALAPPDATA ?? os.homedir()}\\pi-nerdfont-unescape\\cmap.json`
    : process.platform === "darwin"
      ? `${os.homedir()}/Library/Caches/pi-nerdfont-unescape/cmap.json`
      : `${os.homedir()}/.cache/pi-nerdfont-unescape/cmap.json`;
const CMAP_STORE = Symbol.for("pi.nerdfontUnescape.cmap");

type Ranges = Array<[number, number]>;

const CMAP_BUILD_PY = `
import glob, json, os, sys, tempfile
fonts = []
import sys as _sys
if _sys.platform == "win32":
    for root in (os.environ.get("LOCALAPPDATA"), os.environ.get("WINDIR")):
        if root:
            fonts += glob.glob(os.path.join(root, "Fonts", "*"), recursive=True)
elif _sys.platform == "darwin":
    for pat in ("/System/Library/Fonts/**/*", "/Library/Fonts/**/*",
                os.path.expanduser("~/Library/Fonts/**/*")):
        fonts += glob.glob(pat, recursive=True)
else:
    for pat in ("/usr/share/fonts/**/*.tt[fc]", "/usr/share/fonts/**/*.otf",
                "/usr/local/share/fonts/**/*.tt[fc]", "/usr/local/share/fonts/**/*.otf",
                os.path.expanduser("~/.local/share/fonts/**/*.tt[fc]"),
                os.path.expanduser("~/.local/share/fonts/**/*.otf"),
                os.path.expanduser("~/.fonts/**/*.tt[fc]")):
        fonts += glob.glob(pat, recursive=True)
fonts = [f for f in fonts if f.lower().endswith((".ttf", ".ttc", ".otf"))]
fonts = sorted(set(fonts))
cps = set()
if fonts:
    try:
        from fontTools.ttLib import TTFont
        for p in fonts:
            try:
                cps |= set(TTFont(p, fontNumber=0).getBestCmap().keys())
            except Exception:
                pass
    except ImportError:
        sys.exit(3)  # fontTools 缺失：保持未知，不写缓存
rs, s, prev = [], None, None
for cp in sorted(cps):
    if s is None: s = prev = cp
    elif cp == prev + 1: prev = cp
    else: rs.append([s, prev]); s = prev = cp
if s is not None: rs.append([s, prev])
def sig(files):
    import hashlib
    h = hashlib.md5()
    for p in files:
        try: h.update(("%s:%d\n" % (p, os.path.getmtime(p))).encode())
        except OSError: pass
    return h.hexdigest()
if len(sys.argv) > 2 and sys.argv[2] == "sig":
    print(sig(fonts)); sys.exit(0)
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
tmp = tempfile.mktemp(dir=os.path.dirname(sys.argv[1]))
data = json.dumps({"fonts": len(fonts), "ranges": rs, "sig": sig(fonts)})
open(tmp, "w").write(data)
os.replace(tmp, sys.argv[1])
print("cmap cache: %d fonts, %d ranges" % (len(fonts), len(rs)))
`;

function inRanges(rs: Ranges, cp: number): boolean {
  let lo = 0;
  let hi = rs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < rs[mid][0]) hi = mid - 1;
    else if (cp > rs[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 读取磁盘缓存到共享存储；不存在或损坏返回 false。 */
function loadCmapCache(): boolean {
  try {
    const data = JSON.parse(require("node:fs").readFileSync(CMAP_CACHE, "utf8"));
    if (!Array.isArray(data.ranges)) return false;
    (globalThis as any)[CMAP_STORE] = data.ranges as Ranges;
    cmapSig = typeof data.sig === "string" ? data.sig : undefined;
    return true;
  } catch {
    return false;
  }
}

/** 后台构建/刷新缓存（session_start 触发，不阻塞会话）。 */
let cmapSig: string | undefined;

function buildCmapCache(notify?: (msg: string, level: string) => void): void {
  execFile("python3", ["-c", CMAP_BUILD_PY, CMAP_CACHE], { timeout: 120000, maxBuffer: 1 << 24 },
    (err, stdout) => {
      if (!err) {
        loadCmapCache();
        console.error(`[nerdfont-unescape] ${String(stdout).trim()}`);
        return;
      }
      // 失败（含 fontTools 缺失）：类别判定兜底可用，但必须留痕——静默降级是红线
      const msg = `nerdfont-unescape: cmap 不可用（${err.message}）——可渲染性判定退化为类别判断；安装 python3 + fontTools 可恢复`;
      console.error(`[nerdfont-unescape] cmap build FAILED: ${err.message}`);
      notify?.(msg, "warning");
    });
}

function ensureCmapCache(notify?: (msg: string, level: string) => void): void {
  const g = globalThis as any;
  if (g[CMAP_STORE]) return;
  if (!loadCmapCache()) {
    buildCmapCache(notify); // 无缓存：首次构建
    return;
  }
  // 有缓存：签名校验（字体增删/更新则后台重建，旧表继续用，不空窗）
  execFile("python3", ["-c", CMAP_BUILD_PY, CMAP_CACHE, "sig"], { timeout: 20000, maxBuffer: 1 << 16 },
    (err, stdout) => {
      const cur = err ? undefined : String(stdout).trim();
      if (!err && cur && cur !== cmapSig) buildCmapCache(notify);
    });
}

function unescapeAtRisk(text: string): {
  text: string;
  restored: number;
  cps: number[];
  substituted: number[]; // 天生不可见码位，已替换为 □U+XXXX 可见标记
  hatched: number; // 逃生舱字面化次数（双反斜杠 → 单反斜杠展示）
} {
  if (!text.includes("\\u")) return { text, restored: 0, cps: [], substituted: [], hatched: 0 };
  const cps: number[] = [];
  const substituted: number[] = [];
  let hatched = 0;
  const visibleTag = (cp: number) =>
    `${TOFU}U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
  const cmap = (globalThis as any)[CMAP_STORE] as Ranges | undefined;
  // 单趟交替正则：分支A=双反斜杠（逃生舱，字面化），分支B=单反斜杠（还原/替换）。
  // 同一位置先试双后试单；无内部哨兵——哨兵会与用户文本碰撞
  // （2026-10-28 外部评审判例：字面 \uLIT0; 曾被错误改写）。
  const ONE_PASS = /\\{2}u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))|\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g;
  const processSegment = (seg: string) =>
    seg.replace(ONE_PASS, (whole, aBrace?: string, aPlain?: string, brace?: string, plain?: string) => {
      if (aBrace !== undefined || aPlain !== undefined) {
        hatched++; // 逃生舱：双反斜杠 → 单反斜杠字面展示
        return whole.slice(1);
      }
      const cp = parseInt(brace ?? plain!, 16);
      if (isAtRisk(cp)) {
        const notInFonts = cmap !== undefined && !inRanges(cmap, cp);
        if (isInherentlyInvisible(cp) || notInFonts) {
          substituted.push(cp);
          return visibleTag(cp); // 不可见或本机字体无字形：可见标记，拒绝静默失败
        }
        cps.push(cp);
        return String.fromCodePoint(cp);
      }
      return whole; // 安全区（\ufffd、\u0041 等）原样保留
    });
  // 围栏 + 行内代码段保护：保护片段完全不过 processSegment——
  // 逃生舱也不许碰代码（复制保真，2026-10-28 外部评审判例）
  const FENCE = /^[ \t]*(`{3,}|~{3,})/;
  let fenceOpen: { ch: string; len: number } | null = null;
  const out = text
    .split("\n")
    .map((line) => {
      const fm = line.match(FENCE);
      if (fm) {
        const run = fm[1];
        const rest = line.slice((fm.index ?? 0) + fm[0].length);
        if (!fenceOpen) {
          fenceOpen = { ch: run[0], len: run.length }; // 开启行允许信息串（```js）
        } else if (
          run[0] === fenceOpen.ch &&
          run.length >= fenceOpen.len &&
          /^[ \t]*$/.test(rest) // 闭合行必须纯围栏（```x 不算闭合，CommonMark）
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

// ── 码位 → 语义区域命名（用于通知中说明丢/还原字符的“身份”）──
// 命名原则：块级语义名，括注常见用途/知名度；未列出的归 unassigned。
// 覆盖不求穷尽，求“任何常见字符都能叫出有意义的名字”。
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
  if ((cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe) return "Unicode noncharacters";
  if (cp <= 0xffff && !isAssignedBmp(cp)) return "unassigned"; // 精确判断，优于 REGIONS 粗区间
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
  /icon|glyph|图标|字形|圖標|U\+[0-9A-Fa-f]{4,5}|nerd.?font|PUA|private.?use|私有[区區]|零宽|零寬|zero.?width|tag|标签|標籤|变体|變體|variation|selector|选择符|選擇符|非字符|noncharacter|转义|轉義|escape|unicode/i;

// 行内代码段切分：把一行拆为 {文本, 是否受保护} 片段。
// CommonMark 语义：N 个连续反引号开启，等长的 N 个反引号闭合；内容可含
// 不同长度的反引号串（`` `x` `` 这种双反引号包裹是显示反引号代码的
// 标准写法，必须整体保护——v1 正则版在此翻车）。未闭合的串按字面处理，
// 状态不跨行，误判最坏影响一行。围栏行必须先于本函数处理。
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
    // 向后找等长闭合串
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
        j += m2; // 长度不等：是内容，跳过整串
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
      i += n; // 未闭合：字面量，继续
    }
  }
  if (last < line.length) segs.push({ text: line.slice(last), protected: false });
  return segs.length > 0 ? segs : [{ text: line, protected: false }];
}

// 痕迹 → 补框（返回替换后文本与补框数）
const PAIR = /(['"`])([ \t]*)\1/g; // 空引号对（内部仅容空白）
const isQuote = (c: string) => c === "'" || c === '"' || c === "`";

function tofuFill(text: string): { text: string; filled: number; cps: (number | null)[] } {
  let filled = 0;
  const cps: (number | null)[] = []; // 每次补框对应的码位（空引号对无从得知 → null）
  // ① 空引号对/空反引号对：''  ""  ``  → '□'
  //    逐对扫描（而非单条正则），四重防误报：
  //    a) Markdown 围栏行（```/~~~ 开头）整行跳过；
  //    b) 同类字符连写（'''、``` 等）中的伪配对跳过：
  //       前紧贴任意引号 / 后紧贴同类引号时不填；
  //    c) 配对前紧贴 □（已补框或历史损坏痕迹）时跳过——保证幂等、
  //       不叠加破坏；
  //    d) 反引号对若仅隔空白仍与其它反引号相邻，视为引用构造
  //       （如包裹 ``` 的 `` `` `` 外壳），跳过。
  let tfFenceOpen: { ch: string; len: number } | null = null;
  text = text
    .split("\n")
    .map((line) => {
      const tfm = line.match(/^[ \t]*(`{3,}|~{3,})/);
      if (tfm) {
        if (!tfFenceOpen) tfFenceOpen = { ch: tfm[1][0], len: tfm[1].length };
        else if (tfm[1][0] === tfFenceOpen.ch && tfm[1].length >= tfFenceOpen.len) tfFenceOpen = null;
        return line; // a) 围栏行（同字符等长才闭合）
      }
      if (tfFenceOpen) return line; // 围栏内容：代码字面量，不是丢失痕迹
      // e) 包裹结构预扫描：同类引号连写 + 中间仅词字符/私有区字符 + 闭合连写。
      //    两侧空引号对是包裹符而非丢失痕迹——结构检测比关键词可靠
      const wraps: Array<[number, number]> = [];
      const WRAP = /(['"`])\1+([\p{L}\p{N}\p{Co}]+)\1\1+/gu;
      for (const wm of line.matchAll(WRAP)) {
        const q2 = wm[1];
        let close = 0;
        let f = wm[0];
        while (f.endsWith(q2)) {
          f = f.slice(0, -1);
          close++;
        }
        const open = f.length - wm[2].length; // f 已剥除闭合段，无需再减 close
        const cs = wm.index! + open + wm[2].length;
        wraps.push([wm.index!, wm.index! + open - 1], [cs, cs + close - 1]);
      }
      // 行内代码段区间：PAIR 命中其中则视为代码字面量，不是丢失痕迹
      const protectedRanges: Array<[number, number]> = [];
      {
        let cursor = 0;
        for (const seg of splitByInlineSpans(line)) {
          if (seg.protected) protectedRanges.push([cursor, cursor + seg.text.length]);
          cursor += seg.text.length;
        }
      }
      let out = "";
      let last = 0;
      let m: RegExpExecArray | null;
      PAIR.lastIndex = 0;
      while ((m = PAIR.exec(line))) {
        const q = m[1];
        const start = m.index;
        const end = PAIR.lastIndex;
        if (protectedRanges.some(([a, b]) => start >= a && start < b)) continue;
        const before = start > 0 ? line[start - 1] : "";
        const after = end < line.length ? line[end] : "";
        let skip =
          wraps.some(([a2, b2]) => start >= a2 && start <= b2) || // e) 包裹侧对
          isQuote(before) ||
          after === q ||
          before === TOFU; // b) c)
        if (q === "`" && !skip) {
          if (/[ \t]*`$/.test(line.slice(0, start))) skip = true; // d) 前邻
          else if (/^[ \t]*`/.test(line.slice(end))) skip = true; // d) 后邻
        }
        if (skip) continue;
        out += line.slice(last, start) + q + TOFU + q;
        last = end;
        filled++;
        cps.push(null); // 码位不明（字符已无痕丢失）
      }
      return out + line.slice(last);
    })
    .join("\n");
  // ② Lua 码位注释行尾无字形：-- U+E235 → -- U+E235 □（码位可查，区域能命名）
  text = text.replace(/(--[ \t]*U\+[0-9A-Fa-f]{4,5})[ \t]*$/gm, (m) => {
    const hex = /U\+([0-9A-Fa-f]{4,5})/.exec(m);
    const cp = hex ? parseInt(hex[1], 16) : null;
    // 守约检查：该码位字符若已在本消息出现（如转义已还原），行尾无需补框
    if (cp !== null && text.includes(String.fromCodePoint(cp))) return m;
    filled++;
    cps.push(cp);
    return m + " " + TOFU;
  });
  return { text, filled, cps };
}

// 本机 Nerd Font 字形查询脚本（无反斜杠/反引号，避开模板字符串转义地狱）
// starship 各模块默认符号表（由 starship print-config --default 生成，1.26.0；
// 更新：重跑该命令重新生成，见文件尾注释）
const STARSHIP_DEFAULTS_RAW = "aws.symbol=2601,fe0f|azure.symbol=f0805|battery.full_symbol=f0079|battery.charging_symbol=f0084|battery.discharging_symbol=f0083|battery.unknown_symbol=f0091|battery.empty_symbol=f008e|buf.symbol=1f403|bun.symbol=1f95f|character.success_symbol=5b,276f,5d,28,62,6f,6c,64,67,72,65,65,6e,29|character.error_symbol=5b,276f,5d,28,62,6f,6c,64,72,65,64,29|character.vimcmd_symbol=5b,276e,5d,28,62,6f,6c,64,67,72,65,65,6e,29|character.vimcmd_visual_symbol=5b,276e,5d,28,62,6f,6c,64,79,65,6c,6c,6f,77,29|character.vimcmd_replace_symbol=5b,276e,5d,28,62,6f,6c,64,70,75,72,70,6c,65,29|character.vimcmd_replace_one_symbol=5b,276e,5d,28,62,6f,6c,64,70,75,72,70,6c,65,29|claude_context.gauge_full_symbol=2588|claude_context.gauge_partial_symbol=2592|claude_context.gauge_empty_symbol=2591|claude_cost.symbol=1f4b0|claude_model.symbol=1f916|cmake.symbol=25b3|cobol.symbol=2699,fe0f|conda.symbol=1f152|container.symbol=2b22|crystal.symbol=1f52e|daml.symbol=39b|dart.symbol=1f3af|deno.symbol=1f995|docker_context.symbol=1f433|elixir.symbol=1f4a7|elm.symbol=1f333|erlang.symbol=e7b1|fennel.symbol=1f9c5|fortran.symbol=1f175|fossil_branch.symbol=e0a0|fossil_branch.truncation_symbol=2026|gcloud.symbol=2601,fe0f|git_branch.symbol=e0a0|git_branch.truncation_symbol=2026|git_commit.tag_symbol=1f3f7|gleam.symbol=2b50|golang.symbol=1f439|gradle.symbol=1f176|guix_shell.symbol=1f403|haskell.symbol=3bb|haxe.symbol=2318|helm.symbol=2388|hg_branch.symbol=e0a0|hg_branch.truncation_symbol=2026|hostname.ssh_symbol=1f310|java.symbol=2615|jobs.symbol=2726|julia.symbol=b83|kotlin.symbol=1f17a|kubernetes.symbol=2638|lua.symbol=1f319|maven.symbol=1f17c|memory_usage.symbol=1f40f|meson.truncation_symbol=2026|meson.symbol=2b22|mojo.symbol=1f525|nats.symbol=2709,fe0f|netns.symbol=1f6dc|nim.symbol=1f451|nix_shell.symbol=2744,fe0f|nodejs.symbol=e718|ocaml.symbol=1f42b|odin.symbol=d8|opa.symbol=1fa96|openstack.symbol=2601,fe0f|package.symbol=1f4e6|perl.symbol=1f42a|php.symbol=1f418|pijul_channel.symbol=e0a0|pijul_channel.truncation_symbol=2026|pixi.symbol=1f9da|pulumi.symbol=f1b2|python.symbol=1f40d|quarto.symbol=2a01|raku.symbol=1f98b|red.symbol=1f53a|rlang.symbol=1f4d0|ruby.symbol=1f48e|rust.symbol=1f980|scala.symbol=1f182|shlvl.symbol=2195,fe0f|spack.symbol=1f162|status.symbol=274c|status.not_executable_symbol=1f6ab|status.not_found_symbol=1f50d|status.sigint_symbol=1f9f1|status.signal_symbol=26a1|sudo.symbol=1f9d9|swift.symbol=1f426|terraform.symbol=1f4a0|vagrant.symbol=2371|xmake.symbol=25b3|zig.symbol=21af";

// 本机 Nerd Font 字形查询 + starship 默认符号表查询（无反斜杠/反引号）
const NF_LOOKUP_PY = `
import sys, os, glob
query = sys.argv[1].strip()
limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 20
fonts = []
import sys as _sys
if _sys.platform == "win32":
    for root in (os.environ.get("LOCALAPPDATA"), os.environ.get("WINDIR")):
        if root:
            fonts += glob.glob(os.path.join(root, "Fonts", "*"), recursive=True)
elif _sys.platform == "darwin":
    for pat in ("/System/Library/Fonts/**/*.tt[fc]", "/Library/Fonts/**/*.tt[fc]",
                os.path.expanduser("~/Library/Fonts/**/*.tt[fc]")):
        fonts += glob.glob(pat, recursive=True)
else:
    for pat in ("/usr/share/fonts/**/*.tt[fc]", "/usr/local/share/fonts/**/*.tt[fc]",
                os.path.expanduser("~/.local/share/fonts/**/*.tt[fc]"), os.path.expanduser("~/.fonts/**/*.tt[fc]")):
        fonts += glob.glob(pat, recursive=True)
fonts = sorted(set(f for f in fonts if "nerd" in os.path.basename(f).lower()))
names = {}
if fonts:
    try:
        from fontTools.ttLib import TTFont
        for path in fonts:
            try:
                for cp, nm in TTFont(path, fontNumber=0).getBestCmap().items():
                    names.setdefault(cp, nm)
            except Exception:
                pass
    except ImportError:
        pass
bs = chr(92)
def esc(cp):
    return bs + "u%04x" % cp if cp <= 0xFFFF else bs + "u{%x}" % cp
q = query.lower()

# starship 默认符号模式：query 为 starship / starship <module>
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
            parts.append("U+%04X %s %s" % (cp, esc(cp), names.get(cp) or "(no glyph in font)"))
        print("%-28s %s" % (k, "  ".join(parts)))
        shown += 1
    if not ents:
        print("(no module matched; try: starship nodejs / starship git_branch / starship)")
    sys.exit(0)

if not fonts:
    print("No Nerd Font files found under /usr/share/fonts or ~/.local/share/fonts")
    sys.exit(0)
if not names:
    print("fontTools not installed (pip3 install fonttools)")
    sys.exit(0)
direct = None
if q.startswith("u+") and len(q) in (6, 7, 8) and all(c in "0123456789abcdef" for c in q[2:]):
    direct = int(q[2:], 16)
rows, seen = [], set()
for cp, name in names.items():
    if (cp, name) in seen:
        continue
    seen.add((cp, name))
    if direct is not None:
        if cp == direct:
            rows.append((cp, name))
    elif q in name.lower():
        rows.append((cp, name))

# 族别优先级：终端生态惯用族在前（starship/oh-my-zsh 等默认取这些族），同族按码位升序
FAM = ("pl-", "linux-", "fae-", "fa-", "oct-", "md-", "custom-", "seti-", "dev-", "cod-")
def famrank(name):
    for i, p in enumerate(FAM):
        if name.startswith(p):
            return i
    return len(FAM)
rows.sort(key=lambda r: (famrank(r[1]), r[0]))

mode = ("codepoint " if direct is not None else "keyword ") + query
print("nerdfont_lookup: %d Nerd Font file(s), %d match(es) for %s" % (len(fonts), len(rows), mode))
for cp, name in rows[:limit]:
    print("U+%04X  %-34s escape: %-12s" % (cp, name, esc(cp)))
if len(rows) > limit:
    print("... and %d more (increase limit)" % (len(rows) - limit))
if not rows:
    print("(no match; try keywords: python, vim, arch, branch, docker, nodejs, aws; or 'starship <module>')")
`;
// 等宽网格排版渲染：列宽算术 + 边框 + 点线行 + 预览转义 + 可选写真字符文件
const RENDER_PY = `
import sys
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
                    out.append(chr(v) if v <= 0x10FFFF else "[U+%X]" % v)  # 超出码空间：可见标记而非崩溃
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
    t = 0
    for ch in s:
        o = ord(ch)
        if 0x0300 <= o <= 0x036F or 0x200B <= o <= 0x200F or o == 0x2060 or o == 0xFEFF or 0xFE00 <= o <= 0xFE0F:
            continue
        if (0x1100 <= o <= 0x115F or 0x2E80 <= o <= 0xA4CF or 0xA960 <= o <= 0xA97F or
                0xAC00 <= o <= 0xD7A3 or 0xF900 <= o <= 0xFAFF or 0xFE10 <= o <= 0xFE19 or
                0xFE30 <= o <= 0xFE6F or 0xFF00 <= o <= 0xFF60 or 0xFFE0 <= o <= 0xFFE6 or
                0x20000 <= o <= 0x3FFFD):
            t += 2
        else:
            t += 1
    return t

def to_prev(s):
    r = []
    for c in s:
        o = ord(c)
        if 0xE000 <= o <= 0xF8FF:
            r.append(BS + "u%04X" % o)
        elif 0xF0000 <= o <= 0x10FFFD:
            r.append(BS + "u{%X}" % o)  # 增补区 PUA 也必须以转义字面量呈现（通道安全）
        else:
            r.append(c)
    return "".join(r)

src = [unesc(l) for l in content.split("\\n")]

def lw(l):
    if "\t" in l:
        a, _, b = l.partition("\t")
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
        a, _, b = l.partition("\t")
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

  // ④ 码位查询工具：给模型一个权威 oracle（本机 Nerd Font cmap），
  //    避免其凭记忆猜码位、或自行写脚本扫描文件系统（实测代价：
  //    60k 字思考 + 全盘扫描 + 10 分钟 + ~$0.32）
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
      limit: Type.Optional(Type.Number({ description: "max rows to return (default 20)" })),
    }),
    async execute(_toolCallId, params) {
      const out = await new Promise<string>((resolve) => {
        execFile(
          "python3",
          ["-c", NF_LOOKUP_PY, String(params.query), String(params.limit ?? 20)],
          { timeout: 20000, maxBuffer: 1 << 20, env: { ...process.env, NF_STARSHIP: STARSHIP_DEFAULTS_RAW } },
          (err, stdout, stderr) =>
            resolve(err ? `ERROR: failed — ${String(stderr).trim().slice(-200) || err.code || "unknown"}` : stdout),
        );
      });
      return { content: [{ type: "text", text: out }], details: {} };
    },
  });

  // ⑤ 等宽排版渲染工具：列宽算术（CJK=2 列、PUA=1 列）+ 边框 + 点线 +
  //    预览以转义字面量呈现（通道安全）+ 可选把真字符版写入文件
  //    （绕过输出通道剥离，模型无需再手搓对齐脚本）
  pi.registerTool({
    name: "render_preview",
    label: "Render Preview",
    description:
      "Render monospace-grid layouts (posters, status bars, boxed tables) with exact terminal width " +
      "arithmetic: CJK/fullwidth = 2 columns, PUA icons = 1. Content lines support \\uXXXX escapes; " +
      "a line of just '-' or '=' becomes a horizontal rule; a line containing a tab becomes a " +
      "dot-leader row (leftpart<TAB>rightpart). frame: none|ascii|double adds box borders. " +
      "Returns the aligned preview with PUA shown as \\uXXXX literals (channel-safe) plus a width audit; " +
      "writePath additionally writes the real-character version to a file, bypassing the output-channel strip. " +
      "Use this instead of hand-writing alignment scripts in bash.",
    parameters: Type.Object({
      content: Type.String({ description: "layout lines; \\uXXXX escapes OK; '-'/'=' rule lines; tab = dot-leader row" }),
      width: Type.Optional(Type.Number({ description: "target inner width in columns (default: widest line)" })),
      frame: Type.Optional(Type.String({ description: "none | ascii | double (default none)" })),
      writePath: Type.Optional(Type.String({ description: "also write the real-char version to this file" })),
    }),
    async execute(_toolCallId, params) {
      // writePath 安全线：默认仅允许 cwd 与系统 tmp 内；PI_RENDER_ALLOW_ANY=1 显式放开
      if (params.writePath && process.env.PI_RENDER_ALLOW_ANY !== "1") {
        const pathMod = require("node:path");
        const fsMod = require("node:fs");
        const wp = params.writePath;
        const tilde = wp.startsWith("~") ? os.homedir() + wp.slice(1) : wp;
        const abs = pathMod.isAbsolute(tilde) ? tilde : pathMod.resolve(tilde);
        // 真路径判定：符号链接先解析（/tmp/x → /dev/null 不得绕过，外部评审判例）
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
            resolve(err ? `ERROR: failed — ${String(stderr).trim().slice(-200) || err.code || "unknown"}` : stdout),
        ) as any;
        child.stdin?.on("error", () => {});
        child.stdin?.end(params.content ?? "");
      });
      return { content: [{ type: "text", text: out }], details: {} };
    },
  });

  // 洞3｜流级丢失探测：message_update 期间快照 at-risk 码位；message_end
  // 时若快照里的码位在最终文本中消失，即剥离发生在解析层之外的证据。
  // 若剥离发生在更上游（流事件本身已剥），快照恒空，本探测零成本闲置。
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
      if (isAtRisk(cp)) streamSeenCps.add(cp); // 收窄：emoji/普通增补字符改稿不是传输丢失
    }
  });

  // 系统提示注入输出协议（每轮生效）
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt:
        event.systemPrompt +
        `

[nerdfont-unescape 输出协议]
你的输出通道会静默丢弃 BMP 私有区字符（U+E000–U+F8FF；Nerd Font 的
dev-/seti-/cod-/fa-/oct-/custom-/linux- 系图标全在此区，实测必丢）。
增补私有区（U+F0000–U+FFFFD、U+100000–U+10FFFD，md- 系图标在此）、
Tags 区（U+E0000–U+E007F）、非字符（U+FDD0–U+FDEF、各平面
U+xFFFE/U+xFFFF）虽能通过通道，但你难以可靠地直接输出它们，也一律写成
ASCII 转义：\\uXXXX 或 \\u{xxxx} 形式（如 python 图标写 \\uE235，md- 图标
写 \\u{f031f}）。nerdfont-unescape 扩展会在消息落定时把它们还原成真
字符（终端里直接显示为图标）。常规文字（CJK、emoji、零宽字符、变体
选择符等）不受影响，直接写原字符即可。
查找或核实码位时，优先调用 nerdfont_lookup 工具（查询本机 Nerd Font
字形与码位，返回可直接粘贴的转义写法）；starship 默认符号直接查 "starship <module>"（工具内置其默认表，无需访问网络）。不要凭记忆猜码位，也不要
自己写脚本扫描。
未分配码位同样会被丢，一律转义（还原后终端显示为字体豆腐块属正常）。
需要字面展示转义写法时写双反斜杠 \\uXXXX，客户端不会还原它。
读取可能含图标或私有区字符的文件时，用 python 以码位输出而非原
字符（输入方向同样会剥离 BMP 私有区）`,
    };
  });

  // 洞1｜输入侧防护：用户消息里的 at-risk 字符会被通道剥离（模型收不到）。
  // 自动替换为 \uXXXX 转义（协议原生形态，模型可读），并告知用户。
  pi.on("input", async (event, ctx) => {
    let text = event.text;
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

    let restored = 0;
    let filled = 0;
    const restoredCps: number[] = [];
    const substitutedCps: number[] = [];
    const fillKnown: number[] = [];
    let fillUnknown = 0;
    let hatched = 0;

    const content = msg.content.map((block: any) => {
      if (block?.type !== "text" || typeof block.text !== "string") return block;
      const u = unescapeAtRisk(block.text); // ① 还原转义
      let text = u.text;
      restored += u.restored;
      restoredCps.push(...u.cps);
      substitutedCps.push(...u.substituted);
      hatched += u.hatched;
      if (ICON_CONTEXT.test(text)) {
        // ② 痕迹补框（仅相关上下文，压误报）
        const r = tofuFill(text);
        if (r.filled > 0) {
          text = r.text;
          filled += r.filled;
          for (const cp of r.cps) cp === null ? fillUnknown++ : fillKnown.push(cp);
        }
      }
      if (text === block.text) return block;
      return { ...block, text };
    });

    // 洞3：流快照里的 at-risk 码位若在最终文本中消失 → 剥离证据
    if (streamTracking && streamSeenCps.size > 0) {
      // 用映射后（已还原）的文本比对：流里裸字符 + 终稿转义并成功还原
      // 属于同一字符的两种形态，不该同时报 MISSING 与已还原（外部评审判例）
      const finalText = (content as any[])
        .filter((b: any) => b?.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("");
      const dropped = [...streamSeenCps].filter(
        (cp) => !finalText.includes(String.fromCodePoint(cp)),
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

    // 仅逃生舱字面化也必须落盘改写（双反斜杠 → 单反斜杠展示）；
    // 2026-10-28 外部评审判例：此前 hatched 不计数导致改写被这里丢弃（真实假绿）
    if (restored === 0 && filled === 0 && substitutedCps.length === 0) {
      if (hatched > 0) return { message: { ...msg, content } }; // 带上映射后的 content
      return;
    }

    // ③ 告警：先说问题（丢什么、哪个码区），再说处置（补 □ / 已还原），
    //    最后给建议；码区用语义名（rare Han ideographs、Egyptian Hieroglyphs…）
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
      const known = summarize(fillKnown);
      if (known) dropEntries.push(known);
      if (fillUnknown > 0) dropEntries.push(`unknown ×${fillUnknown}`);
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
 * 更新 ASSIGNED_BMP_RAW（BMP 已分配区间随 Unicode 版本演进，约每年一版）：
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
 * 用输出替换 ASSIGNED_BMP_RAW 字符串即可（本表生成于 Unicode 16.0.0）。
 */