/**
 * quantize.mjs — 像素画图纸量化管线（skill 内纯 JS，零第三方依赖）
 *
 * 迁移自 APP BeadQuantizer.ets 核心逻辑（HarmonyOS ArkTS），口径对齐：
 *   - 透明=空位铁律：alpha < CELL_ALPHA_MIN(128) 的格不映射、不产出色号、不参与统计（空位）
 *   - ΔE76 最近色号匹配（Lab 空间，sRGB → XYZ(D65) → Lab 标准变换）
 *   - 格级多数透明判空（opaque*2 < total → 该格为空位）
 *   - 处理报告：结构化决策数据（对齐 APP qstart/paletteMerge 决策日志形态）
 *
 * 运行方式：node >= 18（用内置 zlib 做 PNG 编解码，无任何 npm 依赖）
 */

import zlib from 'node:zlib'

// ---------- 常量（与 APP 对齐） ----------
export const CELL_ALPHA_MIN = 128        // 像素级：alpha >= 此值才参与（APP CELL_ALPHA_MIN）
export const GATE_ADJ_TOL = 5            // 门禁相邻像素容差（APP GATE_ADJ_TOL）
export const GATE_BLOCK_FLAT_TOL = 8     // 门禁块内极差容差（APP GATE_BLOCK_FLAT_TOL）
export const ULTRA_MAX_PIXELS = 100 * 1000 * 1000  // 源图 100MP 上限（与 APP 超清档同口径）

// ---------- 色盘 ----------
export class Palette {
  constructor (entry) {
    this.code = entry.code
    this.name = entry.name
    this.colors = entry.colors.map(c => {
      const rgb = hexToRgb(c.h)
      const lab = rgbToLab(rgb)
      return {
        code: c.c,
        fullCode: c.f || c.c, // 品牌产品码（Perler 80-15179 这类长码）
        name: c.n || '',
        hex: c.h,
        rgb,
        lab,
        hue: Math.atan2(lab[2], lab[1]) * 180 / Math.PI,
        chroma: Math.hypot(lab[1], lab[2]),
        isSkin: isSkinColor(rgb[0], rgb[1], rgb[2])
      }
    })
  }
  /** 最近色号索引（零对象分配——8192 档 67M 格热路径用） */
  nearestIndex (lab) {
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.colors.length; i++) {
      const d = labDist2(lab, this.colors[i].lab)
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }

  /** 最近色号（ΔE76 平方距离）；alpha<128 的调用方应已跳过 */
  nearestLab (lab) {
    const index = this.nearestIndex(lab)
    return { index, dist2: labDist2(lab, this.colors[index].lab), ...this.colors[index] }
  }

  /** 最近色号（ΔE76 平方距离）；alpha<128 的调用方应已跳过 */
  nearest (r, g, b) {
    return this.nearestLab(rgbToLab([r, g, b]))
  }

  nearestLab (lab) {
    // 缓存（2026-10-22 批1）：量化后格色高度重复（纯色块图一图几个色），
    // 键 = Lab 量化到 0.5 精度——同图同色必同键，命中直接返回。
    // 8192 档 67M 格 × 221 色线性扫是性能墙；实测大浪 g96 就有大量重复格色。
    const kL = Math.round(lab[0] * 2); const kA = Math.round(lab[1] * 2); const kB = Math.round(lab[2] * 2)
    const key = kL * 4194304 + kA * 2048 + kB // 21bit+11bit 打包（Lab 范围内无碰撞）
    let hit = this._cache && this._cache.get(key)
    if (hit) return hit
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < this.colors.length; i++) {
      const d = labDist2(lab, this.colors[i].lab)
      if (d < bestD) { bestD = d; best = i }
    }
    const out = { index: best, dist2: bestD, ...this.colors[best] }
    if (!this._cache) this._cache = new Map()
    if (this._cache.size > 500000) this._cache.clear() // 防异常图撑爆内存
    this._cache.set(key, out)
    return out
  }
}

// ---------- 颜色数学 ----------
export function hexToRgb (h) {
  const s = h.replace('#', '').slice(0, 6) // 8 位带 alpha 的源色只取 RGB 部分
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
export function rgbToHex (r, g, b) {
  const f = n => n.toString(16).padStart(2, '0').toUpperCase()
  return f(r) + f(g) + f(b)
}

/** sRGB(0-255) → XYZ(D65) → Lab（标准变换，与 APP rgbToLab 对齐） */
export function rgbToLab (rgb) {
  const [r, g, b] = rgb
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const R = lin(r); const G = lin(g); const B = lin(b)
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = t => (t > 0.008856) ? Math.cbrt(t) : (7.787 * t + 16 / 116)
  const fx = f(X); const fy = f(Y); const fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
export function labDist2 (a, b) {
  const dl = a[0] - b[0]; const da = a[1] - b[1]; const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

/** 肤色启发式（YCbCr；覆盖浅/中/深肤色，排除高饱和红与近黑） */
export function isSkinColor (r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  if (y < 30 || y > 252) return false
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  return cb >= 77 && cb <= 130 && cr >= 133 && cr <= 175
}

/**
 * 敏感色匹配（肤色保护）：候选集限制在「Lab 同色相族 + 所有肤色系色号」内。
 * ⚠️ 不给 ΔE 加权——线性缩放不改变 argmin；必须改变候选集（AGENTS.md P3 教训）。
 */
function nearestSensitiveLab (palette, lab) {
  const hue = Math.atan2(lab[2], lab[1]) * 180 / Math.PI
  const chroma = Math.hypot(lab[1], lab[2])
  let best = -1; let bestD = Infinity
  for (let i = 0; i < palette.colors.length; i++) {
    const c = palette.colors[i]
    let dh = Math.abs(c.hue - hue)
    if (dh > 180) dh = 360 - dh
    if (chroma > 8) {
      if (dh > 30 && !c.isSkin) continue // 有彩肤色：同色相族或肤色系色号
    } else if (c.chroma > 12 && !c.isSkin) {
      continue // 低彩度肤色：优先中性色/肤色系
    }
    const d = labDist2(lab, c.lab)
    if (d < bestD) { bestD = d; best = i }
  }
  if (best < 0) return palette.nearestLab(lab)
  return { index: best, dist2: bestD, ...palette.colors[best] }
}

// ---------- PNG 编解码（零依赖，支持 8bit RGBA/RGB，无隔行） ----------
// 解码返回 { w, h, data: Uint8Array(RGBA) }；编码接收同构输入。仅支持关键 chunk 子集。

function crc32 (buf) {
  let c = ~0
  for (let n = 0; n < buf.length; n++) {
    c ^= buf[n]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1))
  }
  return ~c >>> 0
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32fast (chunks) {
  let c = 0xFFFFFFFF
  for (const buf of chunks) {
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

export function decodePng (bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG')
  let pos = 8
  let w = 0; let h = 0; let bitDepth = 0; let colorType = -1
  const idat = []
  let palette = null; let trns = null
  while (pos < bytes.length) {
    const len = readU32(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const data = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = readU32(bytes, pos + 8); h = readU32(bytes, pos + 12)
      bitDepth = bytes[pos + 16]; colorType = bytes[pos + 17]
      if (bytes[pos + 20] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'PLTE') { palette = data }
    else if (type === 'tRNS') { trns = data }
    else if (type === 'IDAT') { idat.push(data) }
    else if (type === 'IEND') { break }
    pos += 12 + len
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported (got ' + bitDepth + ')')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error('unsupported color type ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * channels
  const out = new Uint8Array(w * h * 4)
  const bpp = channels // bytes per pixel (8bit)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  let src = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[src++]
    cur.set(raw.subarray(src, src + stride)); src += stride
    unfilterLine(filter, cur, prev, bpp)
    for (let x = 0; x < w; x++) {
      let r = 0; let g = 0; let b = 0; let a = 255
      if (colorType === 6) { r = cur[x * 4]; g = cur[x * 4 + 1]; b = cur[x * 4 + 2]; a = cur[x * 4 + 3] }
      else if (colorType === 2) { r = cur[x * 3]; g = cur[x * 3 + 1]; b = cur[x * 3 + 2] }
      else if (colorType === 0) { r = g = b = cur[x] }
      else if (colorType === 4) { r = g = b = cur[x * 2]; a = cur[x * 2 + 1] }
      else if (colorType === 3) {
        const pi = cur[x]
        r = palette[pi * 3]; g = palette[pi * 3 + 1]; b = palette[pi * 3 + 2]
        a = trns && pi < trns.length ? trns[pi] : 255
      }
      const t = (y * w + x) * 4
      out[t] = r; out[t + 1] = g; out[t + 2] = b; out[t + 3] = a
    }
    prev.set(cur)
  }
  return { w, h, data: out }
}

function unfilterLine (filter, cur, prev, bpp) {
  if (filter === 0) return
  for (let i = 0; i < cur.length; i++) {
    const x = cur[i]
    const a = i >= bpp ? cur[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    let v = x
    if (filter === 1) v = x + a
    else if (filter === 2) v = x + b
    else if (filter === 3) v = x + ((a + b) >> 1)
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c)
      const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      v = x + pred
    }
    cur[i] = v & 0xFF
  }
}

export function encodePng (w, h, rgba, colorType = 6) {
  // colorType 6 = RGBA。对完全无 alpha 的图建议传 2（更小）。此处简化只做 6/2。
  const channels = colorType === 6 ? 4 : 3
  const stride = w * channels
  const raw = Buffer.alloc((stride + 1) * h)
  // 简单启发式：每行试 0/1/2/3/4 五种滤波，选压缩后最小者（性能换体积，网格图 0 即可）
  const line = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4
      const d = y * stride + x * channels
      line[x * channels] = rgba[s]; line[x * channels + 1] = rgba[s + 1]; line[x * channels + 2] = rgba[s + 2]
      if (colorType === 6) line[x * channels + 3] = rgba[s + 3]
    }
    // 滤波 0（none）：色块图行内大量重复，deflate 本身即可压得极小
    raw[y * (stride + 1)] = 0
    line.copy(raw, y * (stride + 1) + 1)
    line.copy(prev)
    void prev
  }
  const comp = zlib.deflateSync(raw, { level: 9 })
  function chunk (type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32fast([t, data]))
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', comp),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function readU32 (b, p) { return (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0 }

// ---------- 量化主管线 ----------
/**
 * 生成拼豆图纸核心数据（工作流 A）。
 * opts.grid：网格数（短边对齐；8~8192）
 * opts.dither：'nearest' | 'fs'（默认 nearest——首版先做最近色，FS 抖动待迁移，诚实标注）
 * opts.onReport：处理报告回调（对齐 §6.3 可解释输出）
 * 返回：{
 *   grid: Int16Array(w*h)  // 色盘索引，-1 = 空位（透明=空位铁律）
 *   paletteUsed: [{code,hex,rgb,count,share}]
 *   stats: { colors, beads, empty, w, h, elapsedMs, decisions: [] }
 * }
 */
// ---------- 逐格取样：avg（格内均值） vs dominant（格内主色桶） ----------
/** 格内主色桶：64 级/通道（>>2）分桶取像素数最多的桶求均值。
 *  与 APP cellDominantGrid 同口径（REPORT.md §二.A.2：格内混合 vs 格间翻转是两个问题）。
 *  ⚠️ 为什么不能只用均值：细黑线跨格时被平均成灰（实测 Mondrian 64 档黑线碎成 H7/H6/H16 +
 *     H4 灰，线看起来「断裂」）；纯色块边缘被平均成过渡色。主色桶只取占比最大的真实颜色。 */
const DOMINANT_MAX_CELLS = 2 * 1000 * 1000 // 主色桶超过 200 万格不划算（逐格 Map/桶开销），回退均值
export function makeDominantBuffer () {
  const N = 1 << 18 // 64^3
  return {
    stamp: new Uint32Array(N), epoch: 0,
    sumR: new Float64Array(N), sumG: new Float64Array(N), sumB: new Float64Array(N),
    cnt: new Int32Array(N), touched: new Int32Array(N)
  }
}
/** 返回 [R,G,B,opaqueCount,inkFrac]（box 已被调用方夹取到图内）；无实心像素返回 null。
 *  主色桶之外还有一条「墨线覆盖」规则：格内暗像素占比 ≥ inkMin 时取暗像素均值。
 *  WHY（2026-10-24 简笔画实测）：线宽 < 一格时纯主色桶会把整格判成白底 ⇒ 简笔画整体消失，
 *  只剩眼睛那种大黑块（52×48 的猫脸只剩两只眼睛）。拼豆里「一条线至少要占一颗豆」，
 *  暗像素覆盖够就说明这格应当出线色，否则形就丢了。
 *  ⚠️ 暗判据必须用「相对主色」而不是绝对值：绝对 ΔY≥60 在深色块旁失效（蓝块 Y≈50，
 *     黑线 Y=0 只差 50 ⇒ 黑线在蓝块边缘整条断裂，2026-10-25 几何构成图实测）。
 *     相对判据 Y < 0.55×主色Y − 4：白底(255)抓 Y<136（含反锯齿灰），蓝块(50)抓 Y<23（只抓黑线）。 */
export function cellDominantColor (img, x0, y0, x1, y1, buf, inkMin = 0.15) {
  buf.epoch++
  if (buf.epoch >= 0xFFFFFFFF) { buf.stamp.fill(0); buf.epoch = 1 }
  const ep = buf.epoch
  let touched = 0; let opaque = 0
  for (let y = y0; y < y1; y++) {
    let p = (y * img.w + x0) * 4
    for (let x = x0; x < x1; x++, p += 4) {
      if (img.data[p + 3] < CELL_ALPHA_MIN) continue
      opaque++
      const r = img.data[p]; const g = img.data[p + 1]; const b = img.data[p + 2]
      const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2)
      if (buf.stamp[k] !== ep) {
        buf.stamp[k] = ep; buf.cnt[k] = 0; buf.sumR[k] = 0; buf.sumG[k] = 0; buf.sumB[k] = 0
        buf.touched[touched++] = k
      }
      buf.cnt[k]++; buf.sumR[k] += r; buf.sumG[k] += g; buf.sumB[k] += b
    }
  }
  if (touched === 0) return null
  let best = -1; let bestN = -1
  for (let t = 0; t < touched; t++) { const k = buf.touched[t]; if (buf.cnt[k] > bestN) { bestN = buf.cnt[k]; best = k } }
  const c = buf.cnt[best]
  const domY = (0.299 * buf.sumR[best] + 0.587 * buf.sumG[best] + 0.114 * buf.sumB[best]) / c
  // 墨线覆盖：比主色暗一个档（ΔY ≥ 60/255）的像素合计占比够大 ⇒ 这格是「跨线格」，出线色
  const inkY = domY * 0.55 - 4
  const inkBuckets = []
  for (let t = 0; t < touched; t++) {
    const k = buf.touched[t]
    const n = buf.cnt[k]
    const yv = (0.299 * buf.sumR[k] + 0.587 * buf.sumG[k] + 0.114 * buf.sumB[k]) / n
    if (yv <= inkY && yv <= 200) inkBuckets.push({ k, n, yv })
  }
  const inkN = inkBuckets.reduce((t, b) => t + b.n, 0)
  const inkFrac = opaque > 0 ? inkN / opaque : 0
  if (inkMin > 0 && inkN >= opaque * inkMin) {
    // 线色取「最暗的一半墨像素」的均值，不是全部墨像素：
    // 黑线贴着彩色块时，反锯齿会把暗红/暗蓝混进墨里 ⇒ 均值成暗红 ⇒ 线上缘出现暗红虚线
    // （2026-10-25 Mondrian g48 目检发现，review.png 红框定位）。取最暗一半 ⇒ 均值贴近真实线色。
    inkBuckets.sort((a, b) => a.yv - b.yv)
    let acc = 0; let iR = 0; let iG = 0; let iB = 0
    for (const b of inkBuckets) {
      iR += buf.sumR[b.k]; iG += buf.sumG[b.k]; iB += buf.sumB[b.k]
      acc += b.n
      if (acc >= inkN / 2) break
    }
    return [Math.round(iR / acc), Math.round(iG / acc), Math.round(iB / acc), opaque, inkFrac]
  }
  return [Math.round(buf.sumR[best] / c), Math.round(buf.sumG[best] / c), Math.round(buf.sumB[best] / c), opaque, inkFrac]
}

export function quantizeToGrid (img, palette, opts = {}) {
  const t0 = Date.now()
  const grid = opts.grid || 64
  const dither = opts.dither || 'nearest'
  const sensitive = !!opts.sensitive
  const decisions = []
  decisions.push(`qstart grid=${grid} palette=${palette.code}(${palette.colors.length}) algo=${dither} sensitive=${sensitive}`)

  // 100MP 护栏（与 APP 超清档同口径）
  const px = img.w * img.h
  if (px > ULTRA_MAX_PIXELS) throw new Error(`源图 ${img.w}x${img.h}（${(px / 1e6).toFixed(1)}MP）超过 100MP 上限`)

  // 目标网格：保持宽高比，短边 = grid
  const ratio = img.w / img.h
  let gw; let gh
  if (ratio >= 1) { gh = grid; gw = Math.max(1, Math.round(grid * ratio)) }
  else { gw = grid; gh = Math.max(1, Math.round(grid / ratio)) }
  if (gw > 8192 || gh > 8192) throw new Error(`目标网格 ${gw}x${gh} 超过 8192 上限`)

  // 降采样：逐格取源色（格内 alpha<128 不计）
  //   sample=dominant（默认）：格内主色桶（APP cellDominantGrid 口径）——细线/锐边不被平均成灰；
  //   sample=avg：旧口径（box 均值），对照实验用。
  const nCells = gw * gh
  const wantDominant = opts.sample !== 'avg' && nCells <= DOMINANT_MAX_CELLS
  const sampleMode = wantDominant ? 'dominant' : 'avg'
  if (opts.sample !== 'avg' && !wantDominant) decisions.push(`dominant skipped cells=${nCells} > ${DOMINANT_MAX_CELLS} → avg`)
  const domBuf = wantDominant ? makeDominantBuffer() : null
  const inkMin = opts.inkMin === undefined ? 0.15 : opts.inkMin
  const out = new Int16Array(nCells).fill(-1)
  const counts = new Map() // palette index -> bead count
  // 区域锁定的代表色要用源色中位，只有开了才存（Float32 省内存）
  const lockDe = opts.regionLock || 0
  const srcLab = lockDe > 0 ? new Float32Array(nCells * 3) : null
  const opaqueN = lockDe > 0 ? new Int32Array(nCells) : null
  const cellTotalN = lockDe > 0 ? new Int32Array(nCells) : null
  // RGB → 色号索引缓存（键是取整后的 RGB，命中即跳过 rgbToLab + 全色盘扫描）：
  //   平色图/大背景命中率接近 100%（8192 档实测 10.5s → 见 SKILL.md 数字复现命令）；
  //   照片每格颜色各异 ⇒ 命中率低，故设上限防止 Map 膨胀到 67M 条。
  const rgbCache = opts.noRgbCache ? null : new Map()
  const RGB_CACHE_MAX = 1 << 16
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor(gy * img.h / gh); const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * img.h / gh))
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * img.w / gw); const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * img.w / gw))
      let n = 0; let total = 0
      let R; let G; let B
      if (wantDominant) {
        const c = cellDominantColor(img, x0, Math.min(y0, img.h), Math.min(x1, img.w), Math.min(y1, img.h), domBuf, inkMin)
        total = (Math.min(x1, img.w) - x0) * (Math.min(y1, img.h) - y0)
        if (c) { R = c[0]; G = c[1]; B = c[2]; n = c[3] }
      } else {
        let rS = 0; let gS = 0; let bS = 0
        for (let y = y0; y < y1 && y < img.h; y++) {
          for (let x = x0; x < x1 && x < img.w; x++) {
            const p = (y * img.w + x) * 4
            total++
            if (img.data[p + 3] < CELL_ALPHA_MIN) continue // 透明像素不参与（透明=空位铁律）
            rS += img.data[p]; gS += img.data[p + 1]; bS += img.data[p + 2]; n++
          }
        }
        if (n > 0) { R = Math.round(rS / n); G = Math.round(gS / n); B = Math.round(bS / n) }
      }
      // 格级多数透明判空：opaque*2 < total → 空位（APP 口径）
      const ci = gy * gw + gx
      if (n === 0 || n * 2 < total) { out[ci] = -1; continue }
      if (opaqueN) { opaqueN[ci] = n; cellTotalN[ci] = total }
      const key = (R << 16) | (G << 8) | B
      let idx = rgbCache ? rgbCache.get(key) : undefined
      if (idx === undefined) {
        const lab = rgbToLab([R, G, B])
        idx = sensitive && isSkinColor(R, G, B)
          ? nearestSensitiveLab(palette, lab).index
          : palette.nearestIndex(lab)
        if (rgbCache && rgbCache.size < RGB_CACHE_MAX) rgbCache.set(key, idx)
      }
      out[ci] = idx
      counts.set(idx, (counts.get(idx) || 0) + 1)
      if (srcLab) {
        const lab = rgbToLab([R, G, B])
        const i3 = ci * 3
        srcLab[i3] = lab[0]; srcLab[i3 + 1] = lab[1]; srcLab[i3 + 2] = lab[2]
      }
    }
  }

  // ---------- 区域锁定（--region-lock DE）：同一平色区只留一个色号 ----------
  // 病灶（Mondrian 64 档实测）：照片/扫描件在大色块内有缓慢光照渐变 ⇒ 相邻格颜色接近、
  //   但整块跨过两个近似色号的 Voronoi 分界 ⇒ 红块劈成 F5/F15/F3、蓝块劈成 C16/C20/C12、
  //   黑线碎成 H7/H6/H16（用户反馈「那么多劣化」）。逐格独立映射永远治不了——
  //   必须引入「区域」这一层：源色 4 邻域连通（ΔE ≤ DE）+ 区域中位色，整块一个色号。
  let lockInfo = null
  if (lockDe > 0 && nCells <= 4 * 1000 * 1000) {
    const rl = regionLock(srcLab, opaqueN, cellTotalN, gw, gh, palette, out, { de: lockDe, minArea: opts.lockMinArea || 8 })
    lockInfo = { regions: rl.regions, merged: rl.merged, de: lockDe }
    decisions.push(`regionLock de=${lockDe} minArea=${opts.lockMinArea || 8} regions=${rl.regions} merged=${rl.merged}`)
    out.set(rl.grid) // regionLock 返回新数组，写回本网格
    // 重算统计
    counts.clear()
    for (const v of out) if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1)
  } else if (lockDe > 0) {
    decisions.push(`regionLock skipped cells=${nCells} > 4000000`)
  }

  // 统计 + 处理报告决策数据
  let beads = 0
  const paletteUsed = []
  for (const [idx, cnt] of counts) {
    beads += cnt
    const c = palette.colors[idx]
    paletteUsed.push({ code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, rgb: c.rgb, count: cnt, share: 0 })
  }
  paletteUsed.sort((a, b) => b.count - a.count)
  const totalCells = gw * gh
  for (const c of paletteUsed) c.share = +(c.count / beads * 100).toFixed(2)
  const empty = totalCells - beads
  decisions.push(`cells total=${totalCells} beads=${beads} empty=${empty} colors=${paletteUsed.length}`)
  decisions.push(`emptyRatio=${(empty / totalCells * 100).toFixed(1)}%`)

  const stats = {
    colors: paletteUsed.length, beads, empty, w: gw, h: gh,
    elapsedMs: Date.now() - t0, decisions, sampleMode, lockInfo
  }
  if (opts.onReport) opts.onReport(stats, paletteUsed)
  return { grid: out, paletteUsed, stats }
}

// ---------- 图纸渲染（直映 PNG：空位 alpha=0） ----------
/** 把网格渲染为 PNG。scale = 每格像素数（默认 1 = 直映总览）。
 *  ⚠️ 给人看的图纸必须用 scale>1（每格画成 scale×scale 纯色块）：
 *  1px/格的图被看图器放大时走双线性插值 ⇒ 糊（用户实测 2026-10-21）；
 *  渲染期放大后任何看图器都清晰（同 APP .interpolation(None) 的文件形态等价物）。 */
export function renderGridPng (gridArr, gw, gh, palette, scale = 1) {
  const W = gw * scale; const H = gh * scale
  const rgba = new Uint8Array(W * H * 4)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const idx = gridArr[gy * gw + gx]
      if (idx < 0) continue // 空位保持 alpha=0
      const c = palette.colors[idx].rgb
      const x0 = gx * scale; const y0 = gy * scale
      for (let y = y0; y < y0 + scale; y++) {
        let p = (y * W + x0) * 4
        for (let x = 0; x < scale; x++) {
          rgba[p] = c[0]; rgba[p + 1] = c[1]; rgba[p + 2] = c[2]; rgba[p + 3] = 255
          p += 4
        }
      }
    }
  }
  return encodePng(W, H, rgba, 6)
}

// ---------- 区域锁定（同一平色区只留一个色号，2026-10-24） ----------
/**
 * regionLock —— 在**源色**上做 4 邻域连通域（相邻格 ΔE ≤ de 才连通），
 * 面积 ≥ minArea 的整块改写成「该区源色中位最近的色号」。
 * 病灶：照片/扫描件的大色块内有缓慢光照渐变，逐格映射会跨过两个近似色号的 Voronoi 分界
 *   ⇒ 同一块红劈成 3 个红、黑线碎成 3 种黑（Mondrian 64 档实测，用户反馈「那么多劣化」）。
 *   逐格独立映射治不了——必须引入「区域」层。
 * 与 regionClean 的区别：
 *   - regionClean 在**色号网格**上按邻居多数派逐格吞并（会改动边界形状）；
 *   - regionLock 在**源色**上连通、只改「整块的色号归属」，不动空间形状，平色图更保真。
 * 安全阀：区域内 ΔE 相对中位的 p90 > maxSpread（默认 35）⇒ 该区是真渐变/真细节，不锁。
 * ⚠️ 建议用于几何图/平色插画/扫描件（建议 de 8~14）；照片人像请先用 --compare-matrix 对照。
 */
export function regionLock (srcLab, opaqueN, cellTotal, gw, gh, palette, gridArr, opts = {}) {
  const de = opts.de || 12
  const minArea = opts.minArea || 8
  const maxSpread = opts.maxSpread || 35
  const n = gw * gh
  if (de <= 0 || !srcLab) return { grid: null, regions: 0, merged: 0, locked: 0 }
  const de2 = de * de
  const valid = i => opaqueN[i] > 0 && opaqueN[i] * 2 >= cellTotal[i]
  const parent = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) if (valid(i)) parent[i] = i
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const d2 = (i, j) => {
    const a = i * 3; const b = j * 3
    const dl = srcLab[a] - srcLab[b]; const da = srcLab[a + 1] - srcLab[b + 1]; const db = srcLab[a + 2] - srcLab[b + 2]
    return dl * dl + da * da + db * db
  }
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx
      if (parent[i] < 0) continue
      if (gx + 1 < gw && parent[i + 1] >= 0 && d2(i, i + 1) <= de2) { const a = find(i); const b = find(i + 1); if (a !== b) parent[b] = a }
      if (gy + 1 < gh && parent[i + gw] >= 0 && d2(i, i + gw) <= de2) { const a = find(i); const b = find(i + gw); if (a !== b) parent[b] = a }
    }
  }
  const comps = new Map()
  for (let i = 0; i < n; i++) {
    if (parent[i] < 0) continue
    const r = find(i)
    let c = comps.get(r)
    if (!c) { c = []; comps.set(r, c) }
    c.push(i)
  }
  const out = Int16Array.from(gridArr)
  let regions = 0; let merged = 0; let locked = 0
  const byRoot = new Map()
  for (const members of comps.values()) {
    if (members.length < minArea) {
      for (const i of members) byRoot.set(i, null) // 不锁，保留原映射（含 sensitive 等分支）
      continue
    }
    const L = new Float64Array(members.length)
    const A = new Float64Array(members.length)
    const B = new Float64Array(members.length)
    for (let k = 0; k < members.length; k++) {
      const i3 = members[k] * 3
      L[k] = srcLab[i3]; A[k] = srcLab[i3 + 1]; B[k] = srcLab[i3 + 2]
    }
    const med = arr => { const s = arr.slice().sort(); return s[s.length >> 1] }
    const m = [med(L), med(A), med(B)]
    // 安全阀：p90 离中位太远 = 真渐变/真细节，不锁
    const dev = new Float64Array(members.length)
    for (let k = 0; k < members.length; k++) dev[k] = Math.sqrt(labDist2(m, [L[k], A[k], B[k]]))
    const sorted = dev.slice().sort()
    if (sorted[Math.floor(sorted.length * 0.9)] > maxSpread) {
      for (const i of members) byRoot.set(i, null)
      continue
    }
    const idx = palette.nearestIndex(m)
    regions++; locked++
    for (const i of members) { byRoot.set(i, idx); merged++ }
  }
  for (let i = 0; i < n; i++) {
    if (parent[i] < 0) { out[i] = -1; continue }
    const v = byRoot.get(i)
    out[i] = v === null || v === undefined ? gridArr[i] : v
  }
  return { grid: out, regions, locked, merged }
}

// ---------- regionClean 平色（大面积色块归并，2026-10-21 第二阶段） ----------
/**
 * 8 邻域多数派归并：孤立/边缘格被周围主导色吞并，大面积色块变平。
 * 迁移自 APP regionClean 思想（连通域归并 + 感知分组多数派），纯网格域实现：
 *   - 8 邻域数主导色（count ≥ majority 时吞并当前格）
 *   - **空位（-1）不参与统计、不产生多数派、不被吞并**（透明=空位铁律：空格不映射不扩散）
 *   - 多轮迭代直到稳定（最多 8 轮，防振荡）
 *   - level: 0 关 / 1 标准（≥6/8 邻居同色才吞） / 2 强力（≥5/8）
 *   - **暗线保护**（2026-10-24）：传 palette 时，暗格（L*<30）只要还有暗邻居（= 是线段/结构）
 *     就不被亮色多数派吞掉。WHY：1 格宽的线天然有 6 个亮邻居，默认档会把它整条洗掉
 *     （简笔画 52×48 实测：猫轮廓全丢，只剩眼睛）；孤立的暗点没有暗邻居 ⇒ 照旧被清掉。
 * ⚠️ 平色与抖动是互斥的（APP 铁律：抖动模式跳过一切清理——FS 纹理有意保留）
 */
export function regionClean (gridArr, gw, gh, level = 1, palette = null) {
  if (!level) return { grid: gridArr, merged: 0, rounds: 0 }
  const majority = level >= 2 ? 5 : 6
  const isDark = palette ? v => v >= 0 && palette.colors[v].lab[0] < 30 : () => false
  let cur = gridArr
  let totalMerged = 0
  let rounds = 0
  for (; rounds < 8; rounds++) {
    const next = cur // 原地替换需双缓冲防同轮串扰——这里建副本
    const out = new Int16Array(cur) // 拷贝
    void next
    let merged = 0
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        const v = cur[i]
        if (v < 0) continue // 空位不动
        // 8 邻域计数（只统计非空）
        const cnt = new Map()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx; const ny = y + dy
            if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue
            const nv = cur[ny * gw + nx]
            if (nv < 0) continue // 空位不参与
            cnt.set(nv, (cnt.get(nv) || 0) + 1)
          }
        }
        if (cnt.size === 0) continue
        // 找多数派
        let bestV = -1; let bestC = 0
        for (const [v, c] of cnt) if (c > bestC) { bestC = c; bestV = v }
        if (bestC >= majority && bestV !== v) {
          if (palette && isDark(v) && !isDark(bestV)) {
            // 暗线保护：本格是暗的且还有暗邻居 ⇒ 属于线段/结构，不许被亮色吞
            let darkNb = 0
            for (const nv of cnt.keys()) if (isDark(nv)) { darkNb++; break }
            if (darkNb > 0) continue
          }
          out[i] = bestV
          merged++
        }
      }
    }
    cur = out
    totalMerged += merged
    if (merged === 0) break // 稳定
  }
  return { grid: cur, merged: totalMerged, rounds: rounds + 1 }
}

// ---------- FS 抖动（Lab 域，蛇形扫描 + 反向行镜像扩散核，2026-10-21 第二阶段） ----------
/**
 * ditherMapLab —— 逐格 FS（Floyd–Steinberg）误差扩散，在【量化前】跑（对格色做最近色映射时扩散误差）。
 * 迁移自 APP ditherMapLab 思想：
 *   - Lab 域扩散（ΔE76 是 Lab 距离——误差在该空间才是「视觉误差」）
 *   - 蛇形扫描（偶行左→右，奇行右→左）——打散方向性条纹
 *   - **反向行必须镜像扩散核**（右→左扫时 err 右→err 左，APP 铁律）
 *   - **空位格不映射、不产生误差、不接收误差**（透明=空位铁律）
 *   - intensity 0~1：误差扩散量（0=关，0.5=半强度，1=标准 FS）
 * 实现：对每格先取源色（格均值 RGB→Lab），加累计误差后做最近色映射，误差按核扩散。
 */
export function quantizeWithDither (img, palette, opts = {}) {
  const t0 = Date.now()
  const grid = opts.grid || 64
  const intensity = opts.intensity === undefined ? 1 : opts.intensity
  const sensitive = !!opts.sensitive
  // ⚠️ flatFirst 默认开（2026-10-22，REPORT.md 方案 1 判例法结论）：
  //   平坦区直通+零扩散 = 抖动链的必配护栏，不是可选项——裸 FS 的累计误差会爆炸
  //   （实测最大 712 Lab 单位，源 ΔE 0.6 的纯红格翻成橙色 ΔE 63.9）。
  //   opts.flat === false 可显式关（对比实验用）。
  const flatFirst = opts.flat === undefined ? true : !!opts.flat
  const flatBypassDe = opts.flatBypassDe ?? 22 // REPORT.md 建议阈值 20~25，取中
  // 目标网格：短边 = grid（与 quantizeToGrid 同口径）。
  // ⚠️ 旧实现在横图时算成 gw=grid*ratio / gh=grid/ratio，两侧同时乘除 ⇒ 宽高比被拉成 ratio²
  //   （1000×667 的图出 192×85，比例 2.26 而非 1.5）；2026-10-22 修正。
  const ratio = img.w / img.h
  let gw; let gh
  if (ratio >= 1) { gh = grid; gw = Math.max(1, Math.round(grid * ratio)) }
  else { gw = grid; gh = Math.max(1, Math.round(grid / ratio)) }
  if (gw > 8192 || gh > 8192) throw new Error(`目标网格 ${gw}x${gh} 超过 8192 上限`)
  const px = img.w * img.h
  if (px > ULTRA_MAX_PIXELS) throw new Error(`源图 ${(px / 1e6).toFixed(1)}MP 超过 100MP 上限`)
  // 1) 逐格源色（Lab）+ 不透明像素数（判空用）；sample=dominant 时取格内主色桶
  const srcLab = new Float64Array(gw * gh * 3)
  const opaqueN = new Int32Array(gw * gh)
  const cellTotal = new Int32Array(gw * gh)
  const skinFlag = new Int8Array(gw * gh)
  const flatFlag = new Int8Array(gw * gh)
  const wantDominant = opts.sample !== 'avg' && gw * gh <= DOMINANT_MAX_CELLS
  const domBuf = wantDominant ? makeDominantBuffer() : null
  const inkMin = opts.inkMin === undefined ? 0.15 : opts.inkMin
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor(gy * img.h / gh); const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * img.h / gh))
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * img.w / gw); const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * img.w / gw))
      const i = gy * gw + gx
      let rgb = null
      if (wantDominant) {
        const c = cellDominantColor(img, x0, Math.min(y0, img.h), Math.min(x1, img.w), Math.min(y1, img.h), domBuf, inkMin)
        cellTotal[i] = (Math.min(x1, img.w) - x0) * (Math.min(y1, img.h) - y0)
        opaqueN[i] = c ? c[3] : 0
        if (c) rgb = [c[0], c[1], c[2]]
      } else {
        let rS = 0; let gS = 0; let bS = 0; let n = 0; let total = 0
        for (let y = y0; y < y1 && y < img.h; y++) {
          for (let x = x0; x < x1 && x < img.w; x++) {
            const p = (y * img.w + x) * 4
            total++
            if (img.data[p + 3] < CELL_ALPHA_MIN) continue
            rS += img.data[p]; gS += img.data[p + 1]; bS += img.data[p + 2]; n++
          }
        }
        cellTotal[i] = total
        opaqueN[i] = n
        if (n > 0) rgb = [Math.round(rS / n), Math.round(gS / n), Math.round(bS / n)]
      }
      if (rgb) {
        const lab = rgbToLab(rgb)
        srcLab[i * 3] = lab[0]; srcLab[i * 3 + 1] = lab[1]; srcLab[i * 3 + 2] = lab[2]
        if (sensitive && isSkinColor(rgb[0], rgb[1], rgb[2])) skinFlag[i] = 1
      }
    }
  }
  // 1b) 平坦区双判据标记（REPORT.md 方案 1 完整形态，2026-10-22 补强）：
  //   ① 邻域判据：源图 4 邻域最大 ΔE ≤ FLAT_DE2（原实现，保渐变边界判定）
  //   ② 距离判据：源色到最近色号 ΔE ≤ flatBypassDe（20~25）⇒ 该格直通用源色选色、零扩散
  //     ——REPORT 实测该护栏把抖动平坦翻转率 38.64%→4.33%（与关抖动同值，梯度区抖动保留）
  if (flatFirst) {
    const FLAT_DE2 = 10 * 10
    const BYPASS_DE2 = flatBypassDe * flatBypassDe
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx
        if (opaqueN[i] === 0 || opaqueN[i] * 2 < cellTotal[i]) continue
        const L = srcLab[i * 3]; const A = srcLab[i * 3 + 1]; const B = srcLab[i * 3 + 2]
        // ② 距离判据（先判，命中即平坦）
        const near = palette.nearestLab([L, A, B])
        if (near.dist2 <= BYPASS_DE2) { flatFlag[i] = 1; continue }
        // ① 邻域判据
        let isFlat = true
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const x = gx + dx; const y = gy + dy
          if (x < 0 || x >= gw || y < 0 || y >= gh) continue
          const j = y * gw + x
          if (opaqueN[j] === 0 || opaqueN[j] * 2 < cellTotal[j]) continue
          const d = labDist2([L, A, B], [srcLab[j * 3], srcLab[j * 3 + 1], srcLab[j * 3 + 2]])
          if (d > FLAT_DE2) { isFlat = false; break }
        }
        if (isFlat) flatFlag[i] = 1
      }
    }
  }
  // 2) 蛇形 FS 扩散（err 累加在 workLab 副本上）
  const workLab = new Float64Array(srcLab) // 拷贝
  const out = new Int16Array(gw * gh).fill(-1)
  const counts = new Map()
  // 预转换色盘 Lab（Palette 已带）
  for (let gy = 0; gy < gh; gy++) {
    const ltr = (gy & 1) === 0 // 蛇形：偶行左→右
    for (let k = 0; k < gw; k++) {
      const gx = ltr ? k : gw - 1 - k
      const i = gy * gw + gx
      if (opaqueN[i] === 0 || opaqueN[i] * 2 < cellTotal[i]) continue // 空位：不映射不扩散不接收
      const L = workLab[i * 3]; const A = workLab[i * 3 + 1]; const B = workLab[i * 3 + 2]
      // 最近色（Lab；肤色格走同色相族候选集）
      const targetLab = flatFlag[i] && flatFirst
        ? [srcLab[i * 3], srcLab[i * 3 + 1], srcLab[i * 3 + 2]] // 平坦区不吃误差
        : [L, A, B]
      // 抖动路径 targetLab 是连续浮点（含误差）⇒ rgb 缓存无法命中，只省对象分配（nearestIndex）
      const best = skinFlag[i] ? nearestSensitiveLab(palette, targetLab).index : palette.nearestIndex(targetLab)
      out[i] = best
      counts.set(best, (counts.get(best) || 0) + 1)
      if (flatFlag[i] && flatFirst) continue // 平坦区不把误差扩散给邻居
      // 误差
      const pl = palette.colors[best].lab
      const eL = (L - pl[0]) * intensity; const eA = (A - pl[1]) * intensity; const eB = (B - pl[2]) * intensity
      // FS 核（标准 7/16 3/16 5/16 1/16），按行向镜像
      // 左→右扫：右(x+1)=7/16，左下(x-1,y+1)=3/16，正下=5/16，右下=1/16
      // 右→左扫：镜像 → 左(x-1)=7/16，右下(x+1,y+1)=3/16，正下=5/16，左下=1/16
      // ⚠️ 误差 clamp（2026-10-22，REPORT.md §二.A.1 定罪缺陷修复）：裸 FS 的累计误差
      //   无上界（实测 712 Lab 单位，L 本身只有 0~100）→ 有效色出界成「任意色」。
      //   单次扩散误差夹到 ±ERR_CLAMP（Lab 单位）——不改变 FS 语义（正常格误差远小于此），
      //   只掐断爆炸路径。无 clamp 的 RGB 版 ditherMap 原本就有 clampByte，Lab 版补齐对齐。
      const ERR_CLAMP = 40
      const cE = v => v > ERR_CLAMP ? ERR_CLAMP : v < -ERR_CLAMP ? -ERR_CLAMP : v
      const cL = cE(eL); const cA = cE(eA); const cB = cE(eB)
      const push = (nx, ny, w) => {
        if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) return
        const j = ny * gw + nx
        if (opaqueN[j] === 0 || opaqueN[j] * 2 < cellTotal[j]) return // 空位不接收
        if (flatFlag[j] && flatFirst) return // 平坦区邻居不接收（第二道护栏）
        workLab[j * 3] += cL * w; workLab[j * 3 + 1] += cA * w; workLab[j * 3 + 2] += cB * w
      }
      if (ltr) {
        push(gx + 1, gy, 7 / 16); push(gx - 1, gy + 1, 3 / 16); push(gx, gy + 1, 5 / 16); push(gx + 1, gy + 1, 1 / 16)
      } else {
        push(gx - 1, gy, 7 / 16); push(gx + 1, gy + 1, 3 / 16); push(gx, gy + 1, 5 / 16); push(gx - 1, gy + 1, 1 / 16)
      }
    }
  }
  // 2b) 区域锁定（与 nearest 路径同一实现；opt-in）
  let lockInfo = null
  if ((opts.regionLock || 0) > 0 && gw * gh <= 4 * 1000 * 1000) {
    const rl = regionLock(srcLab, opaqueN, cellTotal, gw, gh, palette, out, { de: opts.regionLock, minArea: opts.lockMinArea || 8 })
    lockInfo = { regions: rl.regions, merged: rl.merged, de: opts.regionLock }
    if (rl.regions > 0) {
      out.set(rl.grid) // regionLock 返回新数组，写回本网格
      counts.clear()
      for (const v of out) if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  // 3) 统计
  let beads = 0
  const paletteUsed = []
  for (const [idx, count] of counts) {
    beads += count
    const c = palette.colors[idx]
    paletteUsed.push({ code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, rgb: c.rgb, count, share: 0 })
  }
  paletteUsed.sort((a, b) => b.count - a.count)
  for (const c of paletteUsed) c.share = +(c.count / beads * 100).toFixed(2)
  const empty = gw * gh - beads
  const flatCells = flatFirst ? flatFlag.reduce((s, v) => s + v, 0) : 0
  const stats = {
    colors: paletteUsed.length, beads, empty, w: gw, h: gh, elapsedMs: Date.now() - t0, flatCells, lockInfo,
    decisions: [`qstart grid=${grid} palette=${palette.code}(${palette.colors.length}) algo=fs intensity=${intensity} sensitive=${sensitive} flat=${flatFirst} sample=${wantDominant ? 'dominant' : 'avg'}`,
      `cells total=${gw * gh} beads=${beads} empty=${empty} colors=${paletteUsed.length}${flatFirst ? ` flatCells=${flatCells}` : ''}${lockInfo ? ` regionLock de=${lockInfo.de} regions=${lockInfo.regions} merged=${lockInfo.merged}` : ''}`]
  }
  return { grid: out, paletteUsed, stats }
}

// ---------- 平色优先（平坦区多数派归并，2026-10-22） ----------
/**
 * applyFlatPriority —— 只对「平坦区」做多数派归并，边缘/纹理保持不动。
 * 平坦判据：该格到 8 邻域的最大 ΔE ≤ flatDe；多数派票数 ≥ minVotes 且候选色与当前格 ΔE ≤ flatDe。
 * 与 regionClean 的区别：regionClean 全图去噪（标准 ≥6/强力 ≥5 邻居同色），
 * flat 只动「低梯度区」，因此可用于 FS 抖动后的天空/肤色压平，不会把笔触/轮廓抹掉。
 * level: 0=关 / 1=标准 / 2=强力
 */
export function applyFlatPriority (gridArr, gw, gh, palette, level = 1) {
  if (level <= 0) return { grid: gridArr, changed: 0, flatCells: 0 }
  const p = level >= 2 ? { flatDe: 12, minVotes: 4, rounds: 2 } : { flatDe: 8, minVotes: 5, rounds: 1 }
  let cur = gridArr
  let changedTotal = 0; let flatTotal = 0
  for (let round = 0; round < p.rounds; round++) {
    const out = new Int16Array(cur)
    let changed = 0; let flatCells = 0
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const i = gy * gw + gx
        const idx = cur[i]
        if (idx < 0) continue
        const lab = palette.colors[idx].lab
        const votes = new Map()
        let maxDE = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const x = gx + dx; const y = gy + dy
            if (x < 0 || x >= gw || y < 0 || y >= gh) continue
            const ni = cur[y * gw + x]
            if (ni < 0) continue
            const de = Math.sqrt(labDist2(lab, palette.colors[ni].lab))
            if (de > maxDE) maxDE = de
            votes.set(ni, (votes.get(ni) || 0) + 1)
          }
        }
        if (maxDE > p.flatDe) continue // 边缘/纹理：不动
        flatCells++
        let bestIdx = -1; let bestVotes = 0
        for (const [ni, v] of votes) if (v > bestVotes) { bestVotes = v; bestIdx = ni }
        if (bestIdx >= 0 && bestIdx !== idx && bestVotes >= p.minVotes &&
          Math.sqrt(labDist2(lab, palette.colors[bestIdx].lab)) <= p.flatDe) {
          out[i] = bestIdx
          changed++
        }
      }
    }
    cur = out
    changedTotal += changed
    flatTotal += flatCells
    if (changed === 0) break
  }
  return { grid: cur, changed: changedTotal, flatCells: flatTotal }
}

// ---------- 边缘描边（Sobel + 就近暗色加深，2026-10-21 第二阶段） ----------
/**
 * applyOutline —— 网格域 Sobel：亮度梯度超阈值的格 = 边缘格 → 换成「色盘中最近且更暗」的色号。
 * 迁移自 APP edgeStrengthGrid + applyOutline 思想（APP 加深系数 ×0.62：边缘格色 L×0.62）。
 * 实现：直接把边缘格的 Lab L 乘 0.62 后重新映射最近色——「就近暗色号」等价于「同色相压暗」。
 * 空位不动；边缘检测用 8 邻域亮度差（比连续域 Sobel 更贴合网格语义）。
 */
export function applyOutline (gridArr, gw, gh, palette, strength = 0.62) {
  // 1) 亮度图（空位记 null → 用 NaN 语义：跳过）
  const lum = new Float64Array(gw * gh).fill(NaN)
  for (let i = 0; i < gw * gh; i++) {
    const v = gridArr[i]
    if (v < 0) continue
    lum[i] = palette.colors[v].lab[0]
  }
  // 2) 边缘格：8 邻域亮度极差 > 阈值（L 阈值 18 ≈ 可见轮廓）
  const EDGE_T = 18
  const edgeCells = []
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const v = gridArr[i]
      if (v < 0 || Number.isNaN(lum[i])) continue
      let mn = Infinity; let mx = -Infinity
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx; const ny = y + dy
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue
          const nl = lum[ny * gw + nx]
          if (Number.isNaN(nl)) continue // 空位邻居跳过
          if (nl < mn) mn = nl
          if (nl > mx) mx = nl
        }
      }
      if (mx - mn > EDGE_T) edgeCells.push(i)
    }
  }
  // 3) 边缘格压暗重映射（L × strength）
  let outlined = 0
  const out = new Int16Array(gridArr)
  for (const i of edgeCells) {
    const v = gridArr[i]
    const lab = palette.colors[v].lab
    const darkLab = [lab[0] * strength, lab[1], lab[2]]
    // 最近色（暗化 Lab）
    let best = -1; let bestD = Infinity
    for (let ci = 0; ci < palette.colors.length; ci++) {
      const pl = palette.colors[ci].lab
      const dl = darkLab[0] - pl[0]; const da = darkLab[1] - pl[1]; const db = darkLab[2] - pl[2]
      const d = dl * dl + da * da + db * db
      if (d < bestD) { bestD = d; best = ci }
    }
    if (best >= 0 && best !== v) { out[i] = best; outlined++ }
  }
  return { grid: out, outlined, edgeCells: edgeCells.length }
}

// ---------- ΔE 色对归并（paletteMerge，2026-10-21 第二阶段） ----------
/**
 * mergeCloseColors —— ΔE76 ≤ 阈值的低用量色对归并：小色并入最近的大色。
 * 迁移自 APP paletteMerge 思想（低用量色并 ΔE 近邻，采购变省）。
 * 规则：只归并「用量占比 < lowShare（默认 3%）」的小色；同 ΔE 取用量大的做宿主。
 * 返回 { grid, merged: [{from,to,dE,beads}], paletteUsed }（重统计后）。
 */
export function mergeCloseColors (gridArr, gw, gh, palette, opts = {}) {
  const deLimit = opts.deLimit ?? 8
  const lowShare = opts.lowShare ?? 0.03
  // 1) 用量统计
  const counts = new Map()
  let beads = 0
  for (let i = 0; i < gw * gh; i++) {
    const v = gridArr[i]
    if (v < 0) continue
    counts.set(v, (counts.get(v) || 0) + 1)
    beads++
  }
  // 2) 低用量色 → 找 ΔE≤deLimit 的更大宿主
  const remap = new Map() // idx -> hostIdx
  const merged = []
  for (const [idx, cnt] of counts) {
    if (cnt / beads >= lowShare) continue // 只动低用量
    const lab = palette.colors[idx].lab
    let bestHost = -1; let bestD = Infinity; let bestCnt = -1
    for (const [hIdx, hCnt] of counts) {
      if (hIdx === idx || hCnt <= cnt) continue // 宿主必须用量更大
      if (hCnt / beads < lowShare && remap.get(hIdx) === undefined) continue // 宿主须非低用量（或已是宿主）
      const hl = palette.colors[hIdx].lab
      const d = Math.sqrt(labDist2(lab, hl))
      if (d <= deLimit && (d < bestD || (d === bestD && hCnt > bestCnt))) { bestD = d; bestHost = hIdx; bestCnt = hCnt }
    }
    if (bestHost >= 0) {
      remap.set(idx, bestHost)
      merged.push({ from: palette.colors[idx].code, to: palette.colors[bestHost].code, dE: +bestD.toFixed(2), beads: cnt })
    }
  }
  // 3) 应用（链式宿主展开）
  const resolve = (v) => {
    let cur = v; const seen = new Set()
    while (remap.has(cur) && !seen.has(cur)) { seen.add(cur); cur = remap.get(cur) }
    return cur
  }
  const out = new Int16Array(gw * gh)
  for (let i = 0; i < gw * gh; i++) {
    const v = gridArr[i]
    out[i] = v < 0 ? v : resolve(v)
  }
  return { grid: out, merged, ...recountColors(out, gw, gh, palette) }
}

// ---------- 前后对比图（compare.png：原图 vs 拼豆效果并排，2026-10-21） ----------
/**
 * renderCompare —— 左「原图」右「拼豆效果」并排 + 顶部标题 + 中缝分隔。
 * 原图：直接下采样缩放（box）；效果：网格渲染（无插值语义由格块天然保证）。
 * 两栏等高（各 targetH px），宽按各自宽高比自适应；中缝 2px 深灰。
 * 上标注：「SOURCE」「BEADS N×N · M colors」（2× 点阵字）。
 */
export function renderCompare (img, gridArr, gw, gh, palette, targetH = 640) {
  const PAD = 12; const HEAD = 26; const GAP = 4
  // 左栏：原图下采样（box）
  const lh = targetH
  const lw = Math.max(1, Math.round(img.w * targetH / img.h))
  const left = new Uint8Array(lw * lh * 4)
  for (let y = 0; y < lh; y++) {
    const sy0 = Math.floor(y * img.h / lh); const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * img.h / lh))
    for (let x = 0; x < lw; x++) {
      const sx0 = Math.floor(x * img.w / lw); const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * img.w / lw))
      let r = 0; let g = 0; let b = 0; let a = 0; let n = 0
      for (let sy = sy0; sy < sy1 && sy < img.h; sy++) {
        for (let sx = sx0; sx < sx1 && sx < img.w; sx++) {
          const p = (sy * img.w + sx) * 4
          r += img.data[p]; g += img.data[p + 1]; b += img.data[p + 2]; a += img.data[p + 3]; n++
        }
      }
      const o = (y * lw + x) * 4
      if (n > 0) {
        left[o] = Math.round(r / n); left[o + 1] = Math.round(g / n); left[o + 2] = Math.round(b / n)
        left[o + 3] = a / n >= CELL_ALPHA_MIN ? 255 : 0
      }
    }
  }
  // 右栏：网格渲染（每格 px 自适应，宽度≈左栏）
  const cell = Math.max(1, Math.floor(lw / gw))
  const rw = gw * cell; const rh = gh * cell
  const right = new Uint8Array(rw * rh * 4)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const v = gridArr[gy * gw + gx]
      if (v < 0) continue
      const c = palette.colors[v].rgb
      for (let y = gy * cell; y < (gy + 1) * cell; y++) {
        for (let x = gx * cell; x < (gx + 1) * cell; x++) {
          const o = (y * rw + x) * 4
          right[o] = c[0]; right[o + 1] = c[1]; right[o + 2] = c[2]; right[o + 3] = 255
        }
      }
    }
  }
  // 右栏缩放到与左栏同高（box 下采样——网格比例仍整倍）
  const rScale = rh !== lh ? lh / rh : 1
  const rw2 = Math.max(1, Math.round(rw * rScale))
  const right2 = new Uint8Array(rw2 * lh * 4)
  for (let y = 0; y < lh; y++) {
    const ry = Math.min(rh - 1, Math.floor(y / rScale))
    for (let x = 0; x < rw2; x++) {
      const rx = Math.min(rw - 1, Math.floor(x / rScale))
      const s = (ry * rw + rx) * 4; const d = (y * rw2 + x) * 4
      right2[d] = right[s]; right2[d + 1] = right[s + 1]; right2[d + 2] = right[s + 2]; right2[d + 3] = right[s + 3]
    }
  }
  // 画布
  const W = PAD + lw + GAP + 2 + GAP + rw2 + PAD
  const H = HEAD + Math.max(lh, lh) + PAD
  const rgba = new Uint8Array(W * H * 4)
  fillRect(rgba, W, H, 0, 0, W, H, [252, 252, 253])
  // 标题
  drawTextScaled(rgba, W, H, 'SOURCE', PAD, 6, 2, [110, 110, 120])
  const rightLabel = `BEADS ${gw}X${gh}`
  drawTextScaled(rgba, W, H, rightLabel, PAD + lw + GAP + 2 + GAP, 6, 2, [110, 110, 120])
  // 左图
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const s = (y * lw + x) * 4; const d = ((y + HEAD) * W + (x + PAD)) * 4
      rgba[d] = left[s]; rgba[d + 1] = left[s + 1]; rgba[d + 2] = left[s + 2]; rgba[d + 3] = left[s + 3]
    }
  }
  // 右图
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < rw2; x++) {
      const s = (y * rw2 + x) * 4
      const d = ((y + HEAD) * W + (x + PAD + lw + GAP + 2 + GAP)) * 4
      rgba[d] = right2[s]; rgba[d + 1] = right2[s + 1]; rgba[d + 2] = right2[s + 2]
      rgba[d + 3] = right2[s + 3] === 0 ? 0 : 255
    }
  }
  // 中缝（2px 深灰）
  vline(rgba, W, H, PAD + lw + GAP, HEAD, lh, [150, 150, 155], 2)
  return encodePng(W, H, rgba, 6)
}

// ---------- 多方案对照拼图（--compare-matrix 用，2026-10-22） ----------
/**
 * renderCompareMatrix —— 把多份 compare.png 拼成 2×N 对照图（带方案标签），AI 一眼选版。
 * entries: [{ label, png }]；label 仅支持 ASCII（5×7 点阵字体），用 nearest/fs/outline/merge 这类短名。
 */
export function renderCompareMatrix (entries) {
  if (!entries || entries.length === 0) throw new Error('renderCompareMatrix 需要至少一个变体')
  const imgs = entries.map(e => ({ label: e.label, ...decodePng(e.png) }))
  const COLS = Math.min(2, imgs.length)
  const ROWS = Math.ceil(imgs.length / COLS)
  const PAD = 16; const GAP = 12; const LABEL_H = 26
  const cellW = Math.max(...imgs.map(i => i.w))
  const cellH = Math.max(...imgs.map(i => i.h))
  const W = PAD * 2 + COLS * cellW + (COLS - 1) * GAP
  const H = PAD * 2 + ROWS * (LABEL_H + cellH) + (ROWS - 1) * GAP
  const rgba = new Uint8Array(W * H * 4)
  fillRect(rgba, W, H, 0, 0, W, H, [24, 24, 28])
  imgs.forEach((im, idx) => {
    const col = idx % COLS; const row = Math.floor(idx / COLS)
    const x0 = PAD + col * (cellW + GAP)
    const y0 = PAD + row * (LABEL_H + cellH + GAP)
    drawTextScaled(rgba, W, H, im.label.toUpperCase().slice(0, 48), x0 + 2, y0 + 6, 2, [228, 228, 238])
    for (let y = 0; y < im.h; y++) {
      for (let x = 0; x < im.w; x++) {
        const s = (y * im.w + x) * 4
        const d = ((y0 + LABEL_H + y) * W + (x0 + x)) * 4
        rgba[d] = im.data[s]; rgba[d + 1] = im.data[s + 1]; rgba[d + 2] = im.data[s + 2]; rgba[d + 3] = im.data[s + 3]
      }
    }
  })
  return encodePng(W, H, rgba, 6)
}

// ---------- 自适应候选集（REPORT.md 方案 4，2026-10-22 批2） ----------
/**
 * buildAdaptivePalette —— 图像主色 → 品牌色盘受限候选集（治 nearest 全色盘的 Voronoi 分界翻转）。
 * 步骤（REPORT 方案 4）：
 *   ① 逐格 Lab 直方图（5bit/通道量化桶）取 top-N 主色（按像素权重）；
 *   ② 每个主色在【完整品牌色盘】取最近色号，去重 → 受限候选集（|候选| ≤ N）；
 *   ③ 用受限集构建新 Palette（code 加 -adaptive 后缀）。
 * ⚠️ 代价（REPORT 明示，须向用户声明）：候选被图像约束后，**可能拿不到用户手里真有的色号**
 *   （自适应集不含它）——「色号不可用」投诉源；默认关，--adaptive N 显式开。
 */
export function buildAdaptivePalette (img, palette, targetN = 24, grid = 64) {
  // ① 逐格 Lab 直方图（粗网格采样即可——主色结构不需要全分辨率）
  const gw = Math.max(1, Math.min(grid, img.w))
  const gh = Math.max(1, Math.min(grid, img.h))
  const buckets = new Map() // rgb 键 → 计数
  for (let y = 0; y < img.h; y += Math.max(1, Math.floor(img.h / gh))) {
    for (let x = 0; x < img.w; x += Math.max(1, Math.floor(img.w / gw))) {
      const p = (y * img.w + x) * 4
      if (img.data[p + 3] < CELL_ALPHA_MIN) continue
      const key = ((img.data[p] >> 4) << 8) | ((img.data[p + 1] >> 4) << 4) | (img.data[p + 2] >> 4)
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
  }
  const topColors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, targetN * 2) // 提 2N 个桶（去重映射后收敛到 ≤N）
    .map(([k]) => [
      ((k >> 8) & 15) * 16 + 8,
      ((k >> 4) & 15) * 16 + 8,
      (k & 15) * 16 + 8
    ])
  // ② 每主色 → 品牌色盘最近色号，去重
  const picked = new Set()
  for (const rgb of topColors) {
    if (picked.size >= targetN) break
    picked.add(palette.nearest(rgb[0], rgb[1], rgb[2]).index)
  }
  const colors = [...picked].map(i => palette.colors[i])
  if (colors.length === 0) throw new Error('自适应候选集为空（图像无有效像素？）')
  // ③ 受限 Palette（保持索引与原色盘一致——paletteUsed 的 code/hex 直接可用）
  const ap = new Palette({ code: palette.code + '-adaptive', name: palette.name + '(自适应)', colors: colors.map(c => ({ c: c.code, h: c.hex })) })
  // ⚠️ 映射时 nearestLab 要在全色盘索引上做？不——受限集的索引是局部索引，
  //   但产物（code/hex）与全色盘同名同色。为保持 gridArr 索引=受限集索引的语义简单，
  //   直接返回受限 Palette（调用方用它量化，gridArr 索引在受限集内自洽）。
  return ap
}

// ---------- 平坦翻转率（REPORT.md 核心指标迁移，2026-10-22） ----------
/**
 * flatFlipRate —— 「像不像」的量化代理（REPORT.md §二.A 定义）：
 *   源图上相邻两格 ΔE ≤ thr（默认 3，肉眼同色）却输出了【不同色号】的邻对占比。
 *   抖动误差爆炸 / Voronoi 分界翻转 / 量化噪声全都会在这里显形——孤点率测不出成片翻转，这个测得出。
 *   返回 { rate, pairs, flips, worst: [{a,b,srcDe,outDe}] }（worst = 输出色号间 ΔE 最大的前 5 对，定罪证据）。
 */
export function flatFlipRate (srcLabGrid, gridArr, gw, gh, palette, thr = 3) {
  const THR2 = thr * thr
  let pairs = 0; let flips = 0
  const worst = []
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw - 1; x++) { // 水平邻对
      const i = y * gw + x; const j = i + 1
      if (gridArr[i] < 0 || gridArr[j] < 0) continue
      if (srcLabGrid[i * 3] === 0 && srcLabGrid[i * 3 + 1] === 0 && srcLabGrid[i * 3 + 2] === 0) continue // 空位源（未填）
      const d2 = labDist2(
        [srcLabGrid[i * 3], srcLabGrid[i * 3 + 1], srcLabGrid[i * 3 + 2]],
        [srcLabGrid[j * 3], srcLabGrid[j * 3 + 1], srcLabGrid[j * 3 + 2]]
      )
      if (d2 > THR2) continue // 源不同色（梯度区）——不算平坦对
      pairs++
      if (gridArr[i] !== gridArr[j]) {
        flips++
        const outDe = Math.sqrt(labDist2(palette.colors[gridArr[i]].lab, palette.colors[gridArr[j]].lab))
        worst.push({ a: palette.colors[gridArr[i]].code, b: palette.colors[gridArr[j]].code, srcDe: +Math.sqrt(d2).toFixed(2), outDe: +outDe.toFixed(2) })
      }
    }
    // 垂直邻对
    if (y < gh - 1) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x; const j = i + gw
        if (gridArr[i] < 0 || gridArr[j] < 0) continue
        if (srcLabGrid[i * 3] === 0 && srcLabGrid[i * 3 + 1] === 0 && srcLabGrid[i * 3 + 2] === 0) continue
        const d2 = labDist2(
          [srcLabGrid[i * 3], srcLabGrid[i * 3 + 1], srcLabGrid[i * 3 + 2]],
          [srcLabGrid[j * 3], srcLabGrid[j * 3 + 1], srcLabGrid[j * 3 + 2]]
        )
        if (d2 > THR2) continue
        pairs++
        if (gridArr[i] !== gridArr[j]) {
          flips++
          const outDe = Math.sqrt(labDist2(palette.colors[gridArr[i]].lab, palette.colors[gridArr[j]].lab))
          worst.push({ a: palette.colors[gridArr[i]].code, b: palette.colors[gridArr[j]].code, srcDe: +Math.sqrt(d2).toFixed(2), outDe: +outDe.toFixed(2) })
        }
      }
    }
  }
  worst.sort((p, q) => q.outDe - p.outDe)
  return { rate: pairs > 0 ? +(flips / pairs * 100).toFixed(2) : 0, pairs, flips, worst: worst.slice(0, 5) }
}

/** 供 flatFlipRate 用的源格 Lab 网格提取（与量化同口径的格均值 Lab） */
export function extractSrcLabGrid (img, gw, gh) {
  const srcLab = new Float64Array(gw * gh * 3)
  const opaqueN = new Int32Array(gw * gh)
  const cellTotal = new Int32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor(gy * img.h / gh); const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * img.h / gh))
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * img.w / gw); const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * img.w / gw))
      let rS = 0; let gS = 0; let bS = 0; let n = 0; let total = 0
      for (let y = y0; y < y1 && y < img.h; y++) {
        for (let x = x0; x < x1 && x < img.w; x++) {
          const p = (y * img.w + x) * 4
          total++
          if (img.data[p + 3] < CELL_ALPHA_MIN) continue
          rS += img.data[p]; gS += img.data[p + 1]; bS += img.data[p + 2]; n++
        }
      }
      const i = gy * gw + gx
      cellTotal[i] = total
      opaqueN[i] = n
      if (n > 0 && n * 2 >= total) {
        const lab = rgbToLab([Math.round(rS / n), Math.round(gS / n), Math.round(bS / n)])
        srcLab[i * 3] = lab[0]; srcLab[i * 3 + 1] = lab[1]; srcLab[i * 3 + 2] = lab[2]
      }
    }
  }
  return srcLab
}

// ---------- 视觉终审（review.png：给多模态大模型看的图，2026-10-25） ----------
/**
 * locateDefects —— 把「可疑格」定位出来（review.png 红框的数据源）。
 * 三类（全走机器可测判据，视觉只做「这是不是真缺陷」的终审）：
 *   break  断线：期望出线（inkCoverage ≥ inkMin）却输出了浅色（L*≥40）
 *   flip   劈叉：源相邻格 ΔE≤3（肉眼同色）却输出两个远色号（输出互差 ΔE≥30）——抖动模式跳过（纹理是故意的）
 *   de     偏色：单格 ΔE≥40 的离群格
 * sev 统一为 0~100「伤害度」标尺（2026-10-25 修复跨类混排缺陷：旧版 break=60−L*、de=ΔE、
 *   flip=30+ΔE/10 量纲各异，ΔE=70 的偏色会压过最严重的断线）。新标尺：
 *   break 70~90（线越亮越伤形，固定压过多数偏色——断线是「形」级伤害）
 *   de    40~90（=min(ΔE,90)）
 *   flip  30~70（输出互差 ΔE 越大越伤）
 * 返回按 sev 降序的前 max 个（默认 12）。
 */
export function locateDefects (img, gridArr, gw, gh, palette, opts = {}) {
  const inkMin = opts.inkMin ?? 0.10
  const max = opts.max ?? 12
  const srcLab = extractSrcLabGrid(img, gw, gh)
  const inkCov = inkCoverageGrid(img, gw, gh)
  const out = []
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = gy * gw + gx
      const idx = gridArr[i]
      if (idx < 0) continue
      const l3 = i * 3
      const sl = [srcLab[l3], srcLab[l3 + 1], srcLab[l3 + 2]]
      if (sl[0] === 0 && sl[1] === 0 && sl[2] === 0) continue
      const outLab = palette.colors[idx].lab
      if (inkCov[i] >= inkMin && outLab[0] >= 40) { out.push({ gx, gy, kind: 'break', sev: 70 + Math.min(20, outLab[0] - 40) }); continue }
      const d = Math.sqrt(labDist2(sl, outLab))
      if (d >= 40) { out.push({ gx, gy, kind: 'de', sev: Math.min(90, d) }); continue }
      if (opts.skipFlip) continue
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const x = gx + dx; const y = gy + dy
        if (x >= gw || y >= gh) continue
        const j = y * gw + x
        const jd = gridArr[j]
        if (jd < 0 || jd === idx) continue
        const k = j * 3
        const sl2 = [srcLab[k], srcLab[k + 1], srcLab[k + 2]]
        if (sl2[0] === 0 && sl2[1] === 0 && sl2[2] === 0) continue
        if (labDist2(sl, sl2) <= 9 && labDist2(outLab, palette.colors[jd].lab) >= 900) {
          out.push({ gx, gy, kind: 'flip', sev: Math.min(70, 30 + Math.sqrt(labDist2(outLab, palette.colors[jd].lab)) / 4) })
          break
        }
      }
    }
  }
  out.sort((a, b) => b.sev - a.sev)
  return out.slice(0, max)
}
/** renderReview —— compare.png 之上给可疑格画红框（左原图/右拼豆各画同一处）。
 *  WHY：多模态大模型的注意力需要被引导——12 处红框 vs 4160 格肉眼扫，检出率天差地别。 */
export function renderReview (img, gridArr, gw, gh, palette, defects, targetH = 640) {
  const c = decodePng(renderCompare(img, gridArr, gw, gh, palette, targetH))
  const W = c.w; const H = c.h; const data = c.data
  const PAD = 12; const HEAD = 26; const GAP = 4
  const lh = targetH
  const lw = Math.max(1, Math.round(img.w * targetH / img.h))
  const rx0 = PAD + lw + GAP + 2 + GAP
  const cell = Math.max(1, Math.floor(lw / gw))
  const rScale = (gh * cell) !== lh ? lh / (gh * cell) : 1
  const RED = [224, 32, 32]
  for (const d of defects) {
    const bs = Math.max(6, Math.round(cell * rScale))
    const bx = Math.round(rx0 + d.gx * cell * rScale); const by = Math.round(HEAD + d.gy * cell * rScale)
    drawBoxRect(data, W, H, bx - 1, by - 1, bs + 2, bs + 2, RED)
    const lx = Math.round(PAD + (d.gx + 0.5) * img.w / gw * lh / img.h)
    const ly = Math.round(HEAD + (d.gy + 0.5) * img.h / gh * lh / img.h)
    drawBoxRect(data, W, H, Math.round(lx - bs / 2) - 1, Math.round(ly - bs / 2) - 1, bs + 2, bs + 2, RED)
  }
  return encodePng(W, H, data, 6)
}
function drawBoxRect (rgba, W, H, x, y, w, h, color) {
  hline(rgba, W, H, y, x, w, color)
  hline(rgba, W, H, y + h - 1, x, w, color)
  vline(rgba, W, H, x, y, h, color)
  vline(rgba, W, H, x + w - 1, y, h, color)
}

// ---------- 自动迭代选参（--refine）的机器指标（2026-10-25） ----------
/**
 * inkCoverageGrid —— 每格「墨线覆盖率」：与 cellDominantColor 同一相对判据
 * （Y < 0.55×该格主色Y − 4）统计暗像素占比。这是「这格本该出线」的期望值：
 * 覆盖率 ≥ inkMin(默认0.10) 的格如果输出了浅色（L*≥40），就是一次断线。
 */
export function inkCoverageGrid (img, gw, gh) {
  const out = new Float32Array(gw * gh)
  const buf = makeDominantBuffer()
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor(gy * img.h / gh); const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * img.h / gh))
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * img.w / gw); const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * img.w / gw))
      const c = cellDominantColor(img, x0, Math.min(y0, img.h), Math.min(x1, img.w), Math.min(y1, img.h), buf, 0)
      if (c) out[gy * gw + gx] = c[4]
    }
  }
  return out
}
/**
 * evalGridQuality —— 图纸 vs 原图的机器保真度（「像不像」的三要素，越低越好）：
 *   cellDe       逐格 ΔE76（源格色 vs 输出色号）均值 / p90 —— 颜色对不对
 *   lineBreak    断线率：期望出线的格（inkCoverage ≥ inkMin）输出了浅色（L*≥40）的占比
 *                —— 简笔画/几何图的「形」在不在
 *   score        综合分 = cellDe + 30×lineBreak + 0.5×平坦翻转率（--refine 选版依据）
 *   （2026-10-25 校准：翻转权重 0.1 时 Mondrian g64 会出现 ink0.1(15.00) 险胜 lock+ink(15.31)
 *    的错选——「红块劈成两片」是用户主诉的最大劣化，翻转率必须压过逐格ΔE的小幅上升）
 * ⚠️ 只在固定网格下可比（不同网格格子大小不同，逐格 ΔE 不可比）。
 */
export function evalGridQuality (img, gridArr, gw, gh, palette, opts = {}) {
  const inkMin = opts.inkMin ?? 0.10
  const srcLab = extractSrcLabGrid(img, gw, gh)
  const inkCov = inkCoverageGrid(img, gw, gh)
  let sum = 0; let cnt = 0
  const devs = []
  let inkCells = 0; let broken = 0
  for (let i = 0; i < gw * gh; i++) {
    const idx = gridArr[i]
    if (idx < 0) continue
    const l3 = i * 3
    const sl = [srcLab[l3], srcLab[l3 + 1], srcLab[l3 + 2]]
    if (sl[0] === 0 && sl[1] === 0 && sl[2] === 0) continue // 空位无源色
    const d = Math.sqrt(labDist2(sl, palette.colors[idx].lab))
    sum += d; cnt++; devs.push(d)
    if (inkCov[i] >= inkMin) {
      inkCells++
      if (palette.colors[idx].lab[0] >= 40) broken++
    }
  }
  devs.sort((a, b) => a - b)
  const cellDe = cnt ? sum / cnt : 0
  const cellDeP90 = cnt ? devs[Math.floor(cnt * 0.9)] : 0
  const lineBreakRate = inkCells ? broken / inkCells : 0
  const ff = flatFlipRate(srcLab, gridArr, gw, gh, palette)
  return {
    cellDe: +cellDe.toFixed(2), cellDeP90: +cellDeP90.toFixed(2),
    lineBreak: +lineBreakRate.toFixed(4), inkCells,
    flip: ff.rate, score: +(cellDe + 30 * lineBreakRate + 0.5 * ff.rate).toFixed(2)
  }
}

// ---------- 平色后重统计（色数/颗数/空位随归并变化） ----------
export function recountColors (gridArr, gw, gh, palette) {
  const counts = new Map()
  let beads = 0
  for (let i = 0; i < gw * gh; i++) {
    const v = gridArr[i]
    if (v < 0) continue
    counts.set(v, (counts.get(v) || 0) + 1)
    beads++
  }
  const paletteUsed = []
  for (const [idx, count] of counts) {
    const c = palette.colors[idx]
    paletteUsed.push({ code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, rgb: c.rgb, count, share: 0 })
  }
  paletteUsed.sort((a, b) => b.count - a.count)
  for (const c of paletteUsed) c.share = +(c.count / beads * 100).toFixed(2)
  return { paletteUsed, stats: { colors: paletteUsed.length, beads, empty: gw * gh - beads } }
}

// ---------- 采购清单 ----------
/** 颗数 → 采购包数（按品牌规格） */
export function purchaseList (paletteUsed, packSize = 200) {
  return paletteUsed.map(c => ({
    code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, count: c.count,
    packs: Math.ceil(c.count / packSize), remainder: c.count % packSize
  }))
}

// ---------- 施工图纸渲染（带网格线 + 行列编号 + 逐格色号——真正的「图纸」形态） ----------

// 5×7 数字点阵字模（0-9，每行 5bit 高位在左）——APP 同款工艺（2026-10-21 迁移）
const FONT5x7 = {
  0: [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  1: [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  2: [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  3: [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  4: [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  5: [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  6: [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  7: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  8: [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  9: [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100]
}
const FONT_W = 5; const FONT_H = 7; const FONT_ADV = 6 // 字距 1px

/** 在 rgba 上画一个字符（5×7 点阵） */
function drawChar (rgba, W, H, ch, x, y, color) {
  const glyph = FONT5x7[ch]
  if (!glyph) return
  for (let gy = 0; gy < FONT_H; gy++) {
    const bits = glyph[gy]
    for (let gx = 0; gx < FONT_W; gx++) {
      if ((bits >> (FONT_W - 1 - gx)) & 1) {
        const px = x + gx; const py = y + gy
        if (px < 0 || px >= W || py < 0 || py >= H) continue
        const p = (py * W + px) * 4
        rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255
      }
    }
  }
}

/**
 * renderAsciiMatrix —— 逐格色号 ASCII 矩阵（空格 = 空位）。
 * 每格按最宽色号对齐；>512 网格文件会很大，由 CLI 决定是否落盘。
 */
export function renderAsciiMatrix (gridArr, gw, gh, palette, opts = {}) {
  const used = new Set()
  for (let i = 0; i < gw * gh; i++) if (gridArr[i] >= 0) used.add(gridArr[i])
  const maxLen = Math.max(2, ...[...used].map(i => palette.colors[i].code.length))
  const empty = opts.empty || '.'.repeat(maxLen)
  const pad = s => String(s).padStart(maxLen, ' ')
  const lines = []
  lines.push(`# ASCII 拼豆图纸 ${gw}x${gh} | ${palette.name}`)
  lines.push(`# 空格 = ${empty}（不放豆）；每行从左到右，色号图例见文末`)
  lines.push('')
  for (let y = 0; y < gh; y++) {
    const row = []
    for (let x = 0; x < gw; x++) {
      const v = gridArr[y * gw + x]
      row.push(pad(v < 0 ? empty : palette.colors[v].code))
    }
    lines.push(row.join(' '))
  }
  lines.push('')
  lines.push('# 色号图例（本图实际用色）')
  for (const idx of [...used].sort((a, b) => a - b)) {
    const c = palette.colors[idx]
    const extra = [c.fullCode && c.fullCode !== c.code ? c.fullCode : '', c.name].filter(Boolean).join(' ')
    lines.push(`${c.code} = #${c.hex}${extra ? ' ' + extra : ''}`)
  }
  return lines.join('\n')
}

/**
 * buildBlockIndex —— 分块索引（每块行列范围 / 豆数 / 主色 topN）。
 * 用于超大网格档「板型分块索引 + 逐块按需展开」。
 */
export function buildBlockIndex (gridArr, gw, gh, palette, splitSize, topN = 3) {
  const blocksX = Math.ceil(gw / splitSize)
  const blocksY = Math.ceil(gh / splitSize)
  const blocks = []
  let bn = 0
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      bn++
      const x0 = bx * splitSize; const y0 = by * splitSize
      const bw = Math.min(splitSize, gw - x0); const bh = Math.min(splitSize, gh - y0)
      const counts = new Map()
      let beads = 0
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const v = gridArr[(y0 + y) * gw + (x0 + x)]
          if (v < 0) continue
          counts.set(v, (counts.get(v) || 0) + 1)
          beads++
        }
      }
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([idx, count]) => {
          const c = palette.colors[idx]
          return { code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, count }
        })
      blocks.push({ block: bn, row0: y0 + 1, row1: y0 + bh, col0: x0 + 1, col1: x0 + bw, rows: bh, cols: bw, beads, top })
    }
  }
  return { splitSize, blocksX, blocksY, total: blocks.length, blocks }
}

/** 画数字串（右对齐/左对齐均可，这里左对齐） */
function drawNumber (rgba, W, H, num, x, y, color) {
  const s = String(num)
  for (let i = 0; i < s.length; i++) {
    drawChar(rgba, W, H, s.charCodeAt(i) - 48, x + i * FONT_ADV, y, color)
  }
}

/** 深浅自适应文字色：底色亮度高画深字，反之画浅字 */
function inkColor (bg) {
  const luma = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
  return luma > 140 ? [32, 32, 32] : [235, 235, 235]
}

/**
 * renderBlueprintSheet —— 施工图纸（每格 = 色块 + 色号文字 + 网格线；边缘行列编号；底部图例）。
 * cellPx：每格像素（须 ≥22 才放得下两位色号；32~48 为舒适阅读档）。
 * opts.ox/oy：分块渲染的全局偏移（块内行列号 = 全局号，跨块对得上）。
 * opts.legend：底部图例行 [{code,hex,rgb,count}]；opts.title：图纸左上标题（如「块 3/8 (行 33-64 × 列 1-32)」）。
 * 布局：左侧行号列 + 顶部列号行（各留 3 字符宽），格间 1px 深灰网格线，每 10 格加粗主线。
 */
export function renderBlueprintSheet (gridArr, gw, gh, palette, cellPx = 36, opts = {}) {
  if (cellPx < 22) throw new Error(`cellPx=${cellPx} 太小，色号文字放不下（需 ≥22）`)
  const ox = opts.ox || 0; const oy = opts.oy || 0
  const legend = opts.legend || []
  const title = opts.title || ''
  const GUTTER = 3 * FONT_ADV + 6 // 编号栏宽（3 字符）
  // 顶部区 = 编号栏 + 标题区（标题按 2× 字模绘制，高 = FONT_H*2）
  const TITLE_H = title ? FONT_H * 2 + 10 : 0
  const TOP_H = GUTTER + TITLE_H
  // 图例：每项 = 色块 14px + 色号 + 空隙 + × + 空隙 + 颗数（2026-10-21 用户反馈：X 易与色号粘连）
  const legendItems = legend.map(c => {
    // 布局：色块[14] 空[6] 色号 空[5] × 空[5] 颗数 空[12]（×前后各留 5px 隙）
    const labelCode = c.code
    const labelCount = String(c.count)
    const w = 14 + 6 + labelCode.length * FONT_ADV + 5 + FONT_W + 5 + labelCount.length * FONT_ADV + 12
    return { code: c.code, rgb: c.rgb, labelCode, labelCount, w }
  })
  const gridW = gw * cellPx; const gridH = gh * cellPx
  // 画布宽 = 网格宽（图例在下方按此宽换行）。
  // ⚠️ 旧实现把「图例总宽」当画布宽 ⇒ 高色数图纸右侧大片空白（96 格实测 3800px 宽，
  //    网格只需 2328px）；且图例换行高度未计入 H ⇒ 第二行起被裁。2026-10-22 修正。
  const titleW = title ? GUTTER + 8 + title.length * (FONT_ADV + 1) * 2 : 0
  const W = Math.max(GUTTER + gridW + 2, titleW, 220)
  const LEGEND_LINE_H = FONT_H + 10
  const legendLines = []
  if (legendItems.length) {
    let line = []; let lx = GUTTER
    for (const it of legendItems) {
      if (line.length > 0 && lx + it.w > W - 8) { legendLines.push(line); line = []; lx = GUTTER }
      line.push(it); lx += it.w
    }
    if (line.length) legendLines.push(line)
  }
  const LEGEND_H = legendLines.length ? 12 + legendLines.length * LEGEND_LINE_H + 4 : 0
  const H = TOP_H + gridH + 2 + LEGEND_H
  const rgba = new Uint8Array(W * H * 4)
  fillRect(rgba, W, H, 0, 0, W, H, [248, 248, 250])
  fillRect(rgba, W, H, 0, 0, GUTTER, H, [240, 240, 244])
  fillRect(rgba, W, H, 0, 0, W, TOP_H, [240, 240, 244])
  const GRID_LINE = [200, 200, 205]
  const GRID_MAJOR = [120, 120, 130]
  // 标题（左上，图例字体同 5×7 放大两倍——手动画 2× 缩放）
  if (title) {
    drawTextScaled(rgba, W, H, title, GUTTER + 4, 4, 2, [50, 50, 60])
  }
  // 列号（顶部编号栏内，不能在网格线以下——否则会被随后绘制的格子覆盖）
  for (let gx = 0; gx < gw; gx++) {
    const cx = GUTTER + gx * cellPx
    drawChar(rgba, W, H, (ox + gx + 1) % 10, cx + Math.floor(cellPx / 2) - Math.floor(FONT_W / 2), TOP_H - FONT_H - 3, [80, 80, 90])
  }
  // 行号（左侧，全局编号）
  for (let gy = 0; gy < gh; gy++) {
    const cy = TOP_H + gy * cellPx
    drawChar(rgba, W, H, (oy + gy + 1) % 10, 10, cy + Math.floor(cellPx / 2) - Math.floor(FONT_H / 2), [80, 80, 90])
  }
  // 格子
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = GUTTER + gx * cellPx; const y0 = TOP_H + gy * cellPx
      const idx = gridArr[gy * gw + gx]
      if (idx < 0) {
        const even = ((gx + gy) & 1) === 0
        fillRect(rgba, W, H, x0, y0, cellPx, cellPx, even ? [232, 232, 236] : [242, 242, 245])
      } else {
        const c = palette.colors[idx]
        fillRect(rgba, W, H, x0, y0, cellPx, cellPx, c.rgb)
        const code = c.code
        const tw = code.length * FONT_ADV - 1
        const tx = x0 + Math.floor((cellPx - tw) / 2)
        const ty = y0 + Math.floor((cellPx - FONT_H) / 2)
        const ink = inkColor(c.rgb)
        for (let i = 0; i < code.length; i++) {
          drawGlyphAuto(rgba, W, H, code.charCodeAt(i), tx + i * FONT_ADV, ty, ink)
        }
      }
    }
  }
  // 网格线
  const gridTop = TOP_H
  for (let gx = 0; gx <= gw; gx++) {
    const major = (ox + gx) % 10 === 0
    const x = GUTTER + gx * cellPx
    vline(rgba, W, H, x, gridTop, gridH, major ? GRID_MAJOR : GRID_LINE, major ? 2 : 1)
  }
  for (let gy = 0; gy <= gh; gy++) {
    const major = (oy + gy) % 10 === 0
    const y = gridTop + gy * cellPx
    hline(rgba, W, H, y, GUTTER, gridW, major ? GRID_MAJOR : GRID_LINE, major ? 2 : 1)
  }
  // 底部图例（色块 + [空隙]色号[空隙]×[空隙]颗数，按画布宽自动换行）
  let ly = gridTop + gridH + 12
  for (const line of legendLines) {
    let lx = GUTTER
    for (const it of line) {
      fillRect(rgba, W, H, lx, ly + 3, 14, 14, it.rgb)
      let tx = lx + 20
      drawText(rgba, W, H, it.labelCode, tx, ly + 7, [50, 50, 60])
      tx += it.labelCode.length * FONT_ADV + 5
      // × 单独画（前空 5px 后空 5px，颜色浅灰与色号区分）
      drawGlyphAuto(rgba, W, H, 88 /* X */, tx, ly + 7, [130, 130, 140])
      tx += FONT_W + 5
      drawText(rgba, W, H, it.labelCount, tx, ly + 7, [50, 50, 60])
      lx += it.w
    }
    ly += LEGEND_LINE_H
  }
  return encodePng(W, H, rgba, 6)
}

/** 画字符串（数字+字母+×），左对齐 */
function drawText (rgba, W, H, s, x, y, color) {
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 215/* × */) { // 乘号画 x 形（简化）
      drawGlyphAuto(rgba, W, H, 88/* X */, x + i * FONT_ADV, y, color)
    } else {
      drawGlyphAuto(rgba, W, H, ch, x + i * FONT_ADV, y, color)
    }
  }
}
/** 画字符串（scale 倍放大，逐像素块放大） */
function drawTextScaled (rgba, W, H, s, x, y, scale, color) {
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 32) continue // 空格
    drawGlyphAutoScaled(rgba, W, H, ch, x + i * (FONT_ADV + 1) * scale, y, scale, color)
  }
}
function drawGlyphAutoScaled (rgba, W, H, ch, x, y, scale, color) {
  const glyph = glyphOf(ch)
  if (!glyph) return
  for (let gy = 0; gy < FONT_H; gy++) {
    const bits = glyph[gy]
    for (let gx = 0; gx < FONT_W; gx++) {
      if ((bits >> (FONT_W - 1 - gx)) & 1) {
        fillRect(rgba, W, H, x + gx * scale, y + gy * scale, scale, scale, color)
      }
    }
  }
}
function glyphOf (ch) {
  if (ch >= 48 && ch <= 57) return FONT5x7[ch - 48]
  return FONT_ALPHA[String.fromCharCode(ch).toUpperCase()]
}

// 大写字母 5×7 字模（色号 F5/H10/C16… 需要）
const FONT_ALPHA = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111]
}
/** 数字或大写字母自动路由（色号字符集 = 0-9 A-Z） */
function drawGlyphAuto (rgba, W, H, ch, x, y, color) {
  if (ch >= 48 && ch <= 57) { drawChar(rgba, W, H, ch - 48, x, y, color); return }
  const key = String.fromCharCode(ch).toUpperCase()
  const glyph = FONT_ALPHA[key]
  if (!glyph) return
  for (let gy = 0; gy < FONT_H; gy++) {
    const bits = glyph[gy]
    for (let gx = 0; gx < FONT_W; gx++) {
      if ((bits >> (FONT_W - 1 - gx)) & 1) {
        const px = x + gx; const py = y + gy
        if (px < 0 || px >= W || py < 0 || py >= H) continue
        const p = (py * W + px) * 4
        rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255
      }
    }
  }
}

function fillRect (rgba, W, H, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue
      const p = (yy * W + xx) * 4
      rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255
    }
  }
}
function vline (rgba, W, H, x, y, len, color, w = 1) {
  for (let yy = y; yy < y + len; yy++) {
    for (let dx = 0; dx < w; dx++) {
      const xx = x + dx
      if (xx >= W || yy >= H) continue
      const p = (yy * W + xx) * 4
      rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255
    }
  }
}
function hline (rgba, W, H, y, x, len, color, h = 1) {
  for (let xx = x; xx < x + len; xx++) {
    for (let dy = 0; dy < h; dy++) {
      const yy = y + dy
      if (xx >= W || yy >= H) continue
      const p = (yy * W + xx) * 4
      rgba[p] = color[0]; rgba[p + 1] = color[1]; rgba[p + 2] = color[2]; rgba[p + 3] = 255
    }
  }
}

// ---------- 合成素材（测试 & 示例用，零外部图片依赖） ----------
/** 合成「透明底 + 纯红圆」图（APP 恒等性验收判据同款素材） */
export function synthTransparentRedCircle (size = 128) {
  const data = new Uint8Array(size * size * 4)
  const c = size / 2; const r = size * 0.38
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c; const dy = y - c
      const inside = dx * dx + dy * dy <= r * r
      const p = (y * size + x) * 4
      if (inside) { data[p] = 255; data[p + 1] = 0; data[p + 2] = 0; data[p + 3] = 255 }
      else { data[p + 3] = 0 }
    }
  }
  return { w: size, h: size, data }
}

/** 合成纯色方格图（网格成品判据素材）：cols×rows 格、cellPx 格宽、含 gap 间隙可选
 *  ⚠️ 色循环用 (row+col) 对角序而非 (row*cols+col) 行序：后者在 cols≡0 (mod 5) 时
 *  上下相邻格恒同色 ⇒ 行边界无变色 ⇒ detectGridByDiff 检不出（AGENTS.md 局限性第 2 条
 *  「紧贴色块图相邻同色格边界检不出」——素材须避开该病态构造，不是管线缺陷）。 */
export function synthGridImage (cols, rows, cellPx = 20, gap = 0, colors) {
  const w = cols * (cellPx + gap) + (gap > 0 ? gap : 0)
  const h = rows * (cellPx + gap) + (gap > 0 ? gap : 0)
  const data = new Uint8Array(w * h * 4)
  const pal = colors || [[230, 57, 70], [29, 53, 87], [42, 157, 143], [255, 183, 3], [0, 0, 0]]
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = pal[(row + col) % pal.length]
      const x0 = gap + col * (cellPx + gap); const y0 = gap + row * (cellPx + gap)
      for (let y = y0; y < y0 + cellPx; y++) {
        for (let x = x0; x < x0 + cellPx; x++) {
          const p = (y * w + x) * 4
          data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255
        }
      }
    }
  }
  return { w, h, data }
}

// ---------- 工作流 B：门禁 + 网格检测（迁移自 PaletteGate / CustomPalette 核心） ----------
/** 四分支 OR 门禁（对齐 looksLikePaletteShot 判据骨架；返回结构化判定供可解释输出） */
export function gateCheck (img) {
  // 采样步长：>512px 的图按 2 步采样，控制纯 JS 循环量
  const step = Math.max(1, Math.floor(Math.max(img.w, img.h) / 512))
  let unique = 0; const seen = new Set()
  let opaque = 0; let total = 0
  const hist = new Map() // rgb string -> count（量化到 32 桶直方图）
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      const p = (y * img.w + x) * 4
      total++
      if (img.data[p + 3] < CELL_ALPHA_MIN) continue
      opaque++
      const key = ((img.data[p] >> 3) << 10) | ((img.data[p + 1] >> 3) << 5) | (img.data[p + 2] >> 3)
      seen.add(key)
      hist.set(key, (hist.get(key) || 0) + 1)
    }
  }
  unique = seen.size
  // flatRatio：显著色占比（>=0.5% 的桶合计）。
  // ⚠️ 分母必须用「不透明像素数」：透明底像素画（alpha=0 背景）若把空位算进分母，
  //    flatRatio 会被稀释（红圆实测 0.453）⇒ 透明像素画被误拒。2026-10-22 修正。
  const denom = opaque > 0 ? opaque : total
  let sig = 0
  const sigColors = [...hist.entries()].filter(([, c]) => c / denom >= 0.005)
  sigColors.sort((a, b) => b[1] - a[1])
  for (const [, c] of sigColors) sig += c
  const flatRatio = denom > 0 ? sig / denom : 0
  const bgShare = sigColors.length > 0 ? sigColors[0][1] / denom : 0
  // 分支判定（阈值对齐 APP）
  const strictPass = unique <= 500 && flatRatio >= 0.6
  const sparseLike = bgShare >= 0.5 && sigColors.length <= 8 && flatRatio >= 0.6
  const illustLike = unique <= 128 && flatRatio >= 0.93
  const pixelArtLike = !strictPass && !sparseLike && !illustLike && unique <= 500 &&
    detectGridByDiff(img) !== null
  // 有间隙色卡：投影检测（背景单色/透明 + 等距 run）
  const projection = unique <= 500 ? detectGridByProjection(img) : null
  const paletteLike = !!projection
  const pass = strictPass || sparseLike || illustLike || pixelArtLike || paletteLike
  return {
    pass, unique, flatRatio: +flatRatio.toFixed(3), bgShare: +bgShare.toFixed(3),
    sigColors: sigColors.length,
    branches: { strictPass, sparseLike, illustLike, pixelArtLike, paletteLike },
    projection,
    report: `[PaletteGate] unique=${unique} flatRatio=${flatRatio.toFixed(2)} pass=${pass} ` +
      `(strict=${strictPass} sparse=${sparseLike} illust=${illustLike} pixelArt=${pixelArtLike} palette=${paletteLike})`
  }
}

/** 差分变色率网格检测（对齐 detectGridByDiff：边界峰等距验证） */
export function detectGridByDiff (img) {
  const { w, h, data } = img
  if (w > 4096 || h > 4096) return null
  // 1) 逐行/列的「变色像素数」
  const colDiff = new Int32Array(w); const rowDiff = new Int32Array(h)
  for (let y = 1; y < h; y++) {
    for (let x = 1; x < w; x++) {
      const p = (y * w + x) * 4; const q = ((y - 1) * w + x) * 4; const r = ((y * w + x - 1) * 4)
      const dh = Math.abs(data[p] - data[q]) > GATE_ADJ_TOL ||
        Math.abs(data[p + 1] - data[q + 1]) > GATE_ADJ_TOL ||
        Math.abs(data[p + 2] - data[q + 2]) > GATE_ADJ_TOL
      const dv = Math.abs(data[p] - data[r]) > GATE_ADJ_TOL ||
        Math.abs(data[p + 1] - data[r + 1]) > GATE_ADJ_TOL ||
        Math.abs(data[p + 2] - data[r + 2]) > GATE_ADJ_TOL
      if (dh) rowDiff[y]++
      if (dv) colDiff[x]++
    }
  }
  // 2) 峰值 = 明显高于行均值的边界线位置
  const colPeaks = findPeaks(colDiff, w)
  const rowPeaks = findPeaks(rowDiff, h)
  if (colPeaks.length < 2 || rowPeaks.length < 2) return null
  // 3) 等距验证（中位间距 ±容差 25%）
  const cols = verifyEquidistant(colPeaks, w)
  const rows = verifyEquidistant(rowPeaks, h)
  if (cols < 2 || rows < 2) return null
  return { cols, rows, colPeaks, rowPeaks }
}

function findPeaks (diff, len) {
  let mean = 0
  for (let i = 0; i < len; i++) mean += diff[i]
  mean /= len
  if (mean <= 0) return []
  const peaks = []
  for (let i = 1; i < len - 1; i++) {
    if (diff[i] > mean * 2 && diff[i] >= diff[i - 1] && diff[i] >= diff[i + 1]) {
      peaks.push(i)
    }
  }
  return peaks
}

function verifyEquidistant (peaks, len) {
  if (peaks.length < 2) return 0
  const gaps = []
  for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1])
  gaps.sort((a, b) => a - b)
  const med = gaps[Math.floor(gaps.length / 2)]
  if (med < 4) return 0 // 间距太小（<4px）视为噪声
  let ok = 0
  for (const g of gaps) if (Math.abs(g - med) <= Math.max(1, med * 0.25)) ok++
  const score = ok / gaps.length
  if (score < 0.8) return 0
  return Math.round(len / med) // 估计格数
}

/**
 * 背景投影网格检测（工作流 B：有间隙色卡）。
 * 思路：找主背景（透明或最高频色）→ 前景掩膜 → 列/行投影 → 连续 run = 格子列/行 → 中心点。
 * 适用：色卡截图/成品照（格子之间有清晰间隙、背景单色或透明）。
 * 紧贴色块图（无间隙）会退化成一整条 run ⇒ 返回 null，交给 detectGridByDiff。
 */
export function detectGridByProjection (img) {
  const { w, h, data } = img
  if (w < 16 || h < 16 || w > 4096 || h > 4096) return null
  // 1) 背景 = 透明像素 或 最高频 5bit 色桶
  const hist = new Map()
  let total = 0; let transparent = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      total++
      if (data[p + 3] < CELL_ALPHA_MIN) { transparent++; continue }
      const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)
      hist.set(key, (hist.get(key) || 0) + 1)
    }
  }
  let bgKey = -1; let bgCount = 0
  for (const [k, c] of hist) if (c > bgCount) { bgCount = c; bgKey = k }
  const bgShare = total > 0 ? Math.max(transparent, bgCount) / total : 0
  if (bgShare < 0.15) return null // 没有主导背景 ⇒ 不像色卡
  const bgRgb = bgKey >= 0
    ? [((bgKey >> 10) & 31) * 8 + 4, ((bgKey >> 5) & 31) * 8 + 4, (bgKey & 31) * 8 + 4]
    : null
  // 2) 前景掩膜 + 投影（容差 26/通道，抗 JPEG 振铃）
  const colCount = new Int32Array(w); const rowCount = new Int32Array(h)
  const tol2 = 26 * 26 * 3
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4
      let isBg = data[p + 3] < CELL_ALPHA_MIN
      if (!isBg && bgRgb) {
        const dr = data[p] - bgRgb[0]; const dg = data[p + 1] - bgRgb[1]; const db = data[p + 2] - bgRgb[2]
        isBg = dr * dr + dg * dg + db * db <= tol2
      }
      if (!isBg) { colCount[x]++; rowCount[y]++ }
    }
  }
  // 3) run = 格子列/行；阈值 = 另一维 20%（格子应贯穿大部分行/列）
  const colRuns = projectionRuns(colCount, Math.max(3, Math.floor(h * 0.2)))
  const rowRuns = projectionRuns(rowCount, Math.max(3, Math.floor(w * 0.2)))
  if (colRuns.length < 2 || rowRuns.length < 2) return null
  if (colRuns.length > 64 || rowRuns.length > 64) return null // 色卡路线 ≤64×64
  const colCoverage = colRuns.reduce((s, r) => s + (r.end - r.start + 1), 0) / w
  const rowCoverage = rowRuns.reduce((s, r) => s + (r.end - r.start + 1), 0) / h
  // 覆盖 >90% 说明没有间隙（一整条 run 被误拆成相邻 run）⇒ 交给差分路线
  if (colCoverage > 0.9 && rowCoverage > 0.9) return null
  if (!runsEvenlySpaced(colRuns) || !runsEvenlySpaced(rowRuns)) return null
  return {
    cols: colRuns.length, rows: rowRuns.length,
    colCenters: colRuns.map(r => Math.round((r.start + r.end) / 2)),
    rowCenters: rowRuns.map(r => Math.round((r.start + r.end) / 2)),
    mode: 'projection',
    bgShare: +bgShare.toFixed(3),
    colCoverage: +colCoverage.toFixed(3),
    rowCoverage: +rowCoverage.toFixed(3)
  }
}

/** 投影连续 run（宽度 <3px 丢弃） */
function projectionRuns (counts, minCount) {
  const runs = []
  let start = -1
  const push = (s, e) => { if (e - s + 1 >= 3) runs.push({ start: s, end: e, center: (s + e) / 2 }) }
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= minCount) { if (start < 0) start = i } else if (start >= 0) { push(start, i - 1); start = -1 }
  }
  if (start >= 0) push(start, counts.length - 1)
  return runs
}

/** run 中心是否近似等距（色卡格距一致；防随机前景误检） */
function runsEvenlySpaced (runs, tol = 0.35) {
  if (runs.length < 2) return false
  const gaps = []
  for (let i = 1; i < runs.length; i++) gaps.push(runs[i].center - runs[i - 1].center)
  gaps.sort((a, b) => a - b)
  const med = gaps[Math.floor(gaps.length / 2)]
  if (med < 4) return false
  let ok = 0
  for (const g of gaps) if (Math.abs(g - med) <= Math.max(2, med * tol)) ok++
  return ok / gaps.length >= 0.75
}

// ---------- 逐格取色（工作流 B 核心） ----------
/** 按检测结果逐格取中心样色，分桶归并出色盘（对齐 bucketMerge）
 *  中心定位：把「边界峰 + 图缘」当区间端点，取各区间中点（对齐 APP 口径）。
 *  ⚠️ 不能用「首峰 + c*间距」当格起点——首峰是格【间】边界不是首格【起】点，
 *  那样整体偏移一格且末格越界（2026-10-21 色卡回环测试揪出的真 bug）。
 *  漏检的边界（相邻同色格）只是把两格并成一格，中点取样仍得同色，不损结果。 */
export function extractColorsFromGrid (img, gridInfo) {
  const { w, h, data } = img
  // 差分路线给边界峰；投影路线直接给格子中心（有间隙色卡）
  const xs = gridInfo.colCenters || intervalCenters(gridInfo.colPeaks || [], w)
  const ys = gridInfo.rowCenters || intervalCenters(gridInfo.rowPeaks || [], h)
  // 中心 3×3 均值取样
  const samples = []
  for (const cy of ys) {
    for (const cx of xs) {
      let rS = 0; let gS = 0; let bS = 0; let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.min(w - 1, Math.max(0, cx + dx)); const y = Math.min(h - 1, Math.max(0, cy + dy))
          const p = (y * w + x) * 4
          if (data[p + 3] < CELL_ALPHA_MIN) continue
          rS += data[p]; gS += data[p + 1]; bS += data[p + 2]; n++
        }
      }
      if (n > 0) samples.push([Math.round(rS / n), Math.round(gS / n), Math.round(bS / n)])
    }
  }
  // 分桶归并（RGB 各 >>3，同桶取平均——对齐 bucketMerge）
  const buckets = new Map()
  for (const s of samples) {
    const key = ((s[0] >> 3) << 10) | ((s[1] >> 3) << 5) | (s[2] >> 3)
    const cur = buckets.get(key)
    if (cur) { cur[0] += s[0]; cur[1] += s[1]; cur[2] += s[2]; cur[3]++ } else buckets.set(key, [s[0], s[1], s[2], 1])
  }
  const colors = [...buckets.values()].map(v => [Math.round(v[0] / v[3]), Math.round(v[1] / v[3]), Math.round(v[2] / v[3])])
  return { colors, samples }
}

/** 边界峰 → 取样区间中点列表（丢过窄区间） */
function intervalCenters (peaks, total) {
  const edges = [0, ...peaks.filter(p => p > 2 && p < total - 2), total]
  const widths = []
  for (let i = 0; i < edges.length - 1; i++) widths.push(edges[i + 1] - edges[i])
  widths.sort((a, b) => a - b)
  const med = widths[Math.floor(widths.length / 2)] || 1
  const centers = []
  for (let i = 0; i < edges.length - 1; i++) {
    const wd = edges[i + 1] - edges[i]
    if (wd < med * 0.5) continue // 过窄 = 间隙/缝隙，不是格子
    centers.push(Math.round((edges[i] + edges[i + 1]) / 2))
  }
  return centers
}

// ---------- 色号匹配（工作流 B⑥） ----------
/** RGB 样色 → 色号 + 置信度分级（ΔE 距离 → 高/中/低置信） */
export function matchToPalette (colors, palette) {
  return colors.map(rgb => {
    const m = palette.nearest(rgb[0], rgb[1], rgb[2])
    const de = Math.sqrt(m.dist2)
    const confidence = de <= 5 ? 'high' : de <= 12 ? 'medium' : 'low'
    return { rgb, code: m.code, hex: m.hex, dE: +de.toFixed(2), confidence }
  })
}

// ---------- 库存持久化（工作流 B⑦，JSON 文件） ----------
export function saveInventory (codes, filePath, fs, extra = {}) {
  const doc = { savedAt: new Date().toISOString(), codes, ...extra }
  fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf-8')
  return doc
}
export function loadInventory (filePath, fs) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

// ---------- 限定色生成（工作流 B⑧） ----------
/** 用库存色号子集构建限定色盘 */
export function buildLimitedPalette (palette, inventoryCodes) {
  const keep = new Set(inventoryCodes)
  const colors = palette.colors
    .filter(c => keep.has(c.code))
    .map(c => ({ c: c.code, h: c.hex, f: c.fullCode, n: c.name }))
  if (colors.length === 0) throw new Error('库存色号在色盘中无一命中，请检查色号输入')
  return new Palette({ code: palette.code + '-stock', name: palette.name + '(库存限定)', colors })
}

// ---------- 缺色分析（工作流 B⑨） ----------
export function missingColorAnalysis (paletteUsed, inventoryCodes) {
  const inv = new Set(inventoryCodes)
  const missing = paletteUsed.filter(c => !inv.has(c.code))
  const covered = paletteUsed.filter(c => inv.has(c.code))
  const coverBeads = covered.reduce((s, c) => s + c.count, 0)
  const totalBeads = paletteUsed.reduce((s, c) => s + c.count, 0)
  return {
    missing, coveredCount: covered.length,
    coverage: totalBeads > 0 ? +(coverBeads / totalBeads * 100).toFixed(1) : 0,
    report: `库存 ${inv.size} 色覆盖 ${covered.length}/${paletteUsed.length} 用色（${(totalBeads > 0 ? (coverBeads / totalBeads * 100).toFixed(1) : 0)}% 颗数），缺 ${missing.length} 色共 ${missing.reduce((s, c) => s + c.count, 0)} 颗`
  }
}
