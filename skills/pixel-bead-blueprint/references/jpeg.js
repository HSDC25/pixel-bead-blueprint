/**
 * jpeg.js — baseline JPEG 解码器（skill 内纯 JS，零第三方依赖）
 *
 * 为什么需要：用户拍照/网图几乎全是 JPEG；skill 输入必须直接吃 JPEG（PNG 之外的另一半世界）。
 * 支持：baseline DCT、huffman（DHT 自带表）、YCbCr 420/422/444 与灰度、restart interval（DRI/RSTn）、
 *       EXIF Orientation（1~8，解码后自动转正——手机竖拍照片的像素常是横向存储）。
 * 不支持：progressive（SOF2）——探测到即抛可读错误（建议转 baseline/PNG）；算术编码。
 * 输出与 decodePng 同构：{ w, h, data: Uint8Array(RGBA) }，alpha 恒 255。
 *
 * 运行方式：node >= 18，无任何 npm 依赖。
 */

// ---------- 位读取器（MSB first，跨字节处理 0xFF00 stuffing） ----------
class BitReader {
  constructor (buf, start) {
    this.buf = buf; this.pos = start; this.bits = 0; this.acc = 0
    this.markerHit = false
  }
  refill () {
    while (this.bits <= 24) {
      if (this.pos >= this.buf.length) { this.markerHit = true; return }
      let b = this.buf[this.pos]
      if (b === 0xFF) {
        const nxt = this.buf[this.pos + 1]
        if (nxt === 0x00) { this.pos += 2 } else if (nxt >= 0xD0 && nxt <= 0xD7) {
          // restart marker：不能跨块取数——由外层处理；这里标记并停
          this.markerHit = true; return
        } else { this.markerHit = true; return }
      } else { this.pos++ }
      this.acc = (this.acc << 8) | b
      this.bits += 8
    }
  }
  read (n) {
    if (n === 0) return 0
    if (this.bits < n) this.refill()
    if (this.bits < n) { this.markerHit = true; return 0 } // 数据不足（截尾容错）
    const v = (this.acc >>> (this.bits - n)) & ((1 << n) - 1)
    this.bits -= n
    return v
  }
  // Huffman：查表（无表时逐位走树）
  decodeHuff (table) {
    let code = 0; let len = 0
    // 表驱动：code >> (len-1) 前缀，标准 JPEG huffman 快查实现
    while (len <= 16) {
      const b = this.read(1)
      if (this.markerHit && this.bits <= 0) return -1
      code = (code << 1) | b; len++
      const val = table.lookup[len] && table.lookup[len][code]
      if (val !== undefined) return val
    }
    return -1
  }
  syncByte () { this.bits = 0; this.acc = 0 }
}

// ---------- Huffman 表构建 ----------
function buildHuffTable (counts, symbols) {
  // counts[1..16]：各长度码数；symbols：按序符号
  const lookup = Array.from({ length: 17 }, () => ({}))
  let code = 0; let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len]; i++) {
      lookup[len][code] = symbols[k++]
      code++
    }
    code <<= 1
  }
  return { lookup }
}

// ---------- IDCT（8×8，两步分离变换；COS[y*8+u] = 0.5·c(u)·cos((2y+1)uπ/16)） ----------
const COS = (() => {
  const t = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      t[y * 8 + u] = 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos((2 * y + 1) * u * Math.PI / 16)
    }
  }
  return t
})()
function idct (coef, out) {
  const tmp = new Float64Array(64)
  // 行变换（u → x）
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = coef[y * 8] * COS[x * 8] // u=0（COS 含 √½ 因子）
      for (let u = 1; u < 8; u++) s += coef[y * 8 + u] * COS[x * 8 + u]
      tmp[y * 8 + x] = s
    }
  }
  // 列变换（v → y）
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = tmp[x] * COS[y * 8] // v=0
      for (let v = 1; v < 8; v++) s += tmp[v * 8 + x] * COS[y * 8 + v]
      out[y * 8 + x] = s
    }
  }
}

// ---------- 主解码 ----------
/**
 * decodeJpeg(bytes: Uint8Array) → { w, h, data: Uint8Array(RGBA) }
 * 抛错：非 JPEG / progressive（SOF2）/ 算术编码 / 数据损坏
 */
export function decodeJpeg (bytes) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('not a JPEG (missing SOI)')
  let pos = 2
  let width = 0; let height = 0
  let comps = [] // { id, h, v, tq }
  let qTables = {} // id → Int32Array(64)（zigzag 序）
  let dcTables = {}; let acTables = {}
  let restartInterval = 0
  let exifOrientation = 1
  let scan = null // { comps: [{comp, td, ta}], }

  while (pos < bytes.length) {
    if (bytes[pos] !== 0xFF) { pos++; continue }
    const marker = bytes[pos + 1]
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { pos += 2; continue }
    if (marker === 0xD9) break // EOI
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3]
    const seg = bytes.subarray(pos + 4, pos + 2 + len)
    switch (marker) {
      case 0xDB: { // DQT
        let p = 0
        while (p < seg.length) {
          const pq = seg[p] >> 4; const tq = seg[p] & 15; p++
          const t = new Int32Array(64)
          for (let i = 0; i < 64; i++) {
            t[i] = pq ? (seg[p] << 8) | seg[p + 1] : seg[p]
            p += pq ? 2 : 1
          }
          qTables[tq] = t
        }
        break
      }
      case 0xC0: case 0xC1: { // SOF0/1 baseline
        const prec = seg[0]
        if (prec !== 8) throw new Error('unsupported precision ' + prec)
        height = (seg[1] << 8) | seg[2]
        width = (seg[3] << 8) | seg[4]
        const nc = seg[5]
        comps = []
        for (let i = 0; i < nc; i++) {
          comps.push({ id: seg[6 + i * 3], h: seg[7 + i * 3] >> 4, v: seg[7 + i * 3] & 15, tq: seg[8 + i * 3] })
        }
        break
      }
      case 0xC2: throw new Error('progressive JPEG not supported (SOF2)——请转存 baseline 或 PNG 后重试')
      case 0xC9: throw new Error('arithmetic coding JPEG not supported')
      case 0xC4: { // DHT
        let p = 0
        while (p < seg.length) {
          const tc = seg[p] >> 4; const th = seg[p] & 15; p++
          const counts = []
          let total = 0
          for (let i = 1; i <= 16; i++) { counts[i] = seg[p + i - 1]; total += counts[i] }
          p += 16
          const symbols = Array.from(seg.subarray(p, p + total))
          p += total
          const table = buildHuffTable(counts, symbols)
          if (tc === 0) dcTables[th] = table; else acTables[th] = table
        }
        break
      }
      case 0xDD: { // DRI
        restartInterval = (seg[0] << 8) | seg[1]
        break
      }
      case 0xE1: { // APP1（EXIF）——只取 Orientation（手机竖拍照片的像素常是横向存储）
        if (exifOrientation === 1) exifOrientation = readExifOrientation(seg)
        break
      }
      case 0xDA: { // SOS
        const ns = seg[0]
        const sComps = []
        for (let i = 0; i < ns; i++) {
          const cid = seg[1 + i * 2]
          const td = seg[2 + i * 2] >> 4; const ta = seg[2 + i * 2] & 15
          const comp = comps.find(c => c.id === cid)
          if (!comp) throw new Error('SOS references unknown component ' + cid)
          sComps.push({ comp, td, ta })
        }
        scan = { comps: sComps, dataStart: pos + 2 + len }
        break
      }
      default: break // APPn/COM/其他——跳过
    }
    pos += 2 + len
    if (scan) break // SOS 后面是熵编码数据，不再走段循环
  }
  if (!scan) throw new Error('JPEG missing SOS')
  if (!width || !height) throw new Error('JPEG missing SOF')
  // 解码前置护栏：尺寸校验先于组件平面/输出分配（伪造超大 SOF → 可读错误而非 OOM；阈值与 quantize.js ULTRA_MAX_PIXELS 一致）
  {
    const px = width * height
    if (px > 100 * 1000 * 1000) throw new Error(`JPEG 尺寸 ${width}x${height}（${(px / 1e6).toFixed(1)}MP）超过 100MP 上限`)
  }

  // ---------- 熵解码 + 反量化 + IDCT ----------
  const hmax = Math.max(...comps.map(c => c.h))
  const vmax = Math.max(...comps.map(c => c.v))
  const mcuW = hmax * 8; const mcuH = vmax * 8
  const mcusX = Math.ceil(width / mcuW)
  const mcusY = Math.ceil(height / mcuH)
  // 每组件的整图平面（MCU 对齐；越界块解码后裁剪）
  const planes = comps.map(c => {
    const pw = mcusX * c.h * 8; const ph = mcusY * c.v * 8
    return { c, w: pw, h: ph, data: new Uint8Array(pw * ph) }
  })

  const br = new BitReader(bytes, scan.dataStart)
  let pred = new Map() // comp id → DC 预测
  const coef = new Int32Array(64)
  const blk = new Float64Array(64)
  let mcuCount = 0

  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (const sc of scan.comps) {
        const { comp } = sc
        const qt = qTables[comp.tq]
        if (!qt) throw new Error('missing quant table ' + comp.tq)
        const dcT = dcTables[sc.td]; const acT = acTables[sc.ta]
        if (!dcT || !acT) throw new Error('missing huffman table')
        for (let by = 0; by < comp.v; by++) {
          for (let bx = 0; bx < comp.h; bx++) {
            // restart
            if (restartInterval > 0 && mcuCount > 0 && mcuCount % restartInterval === 0 && mx === 0 && by === 0 && bx === 0 && br.markerHit) {
              pred.set(comp.id, 0)
              // 跳到 RSTn 后（外层已把 br 推进；简化：找到下一个非 FF D0-D7）
              br.syncByte()
              while (br.pos < bytes.length) {
                if (bytes[br.pos] === 0xFF && bytes[br.pos + 1] >= 0xD0 && bytes[br.pos + 1] <= 0xD7) { br.pos += 2; break }
                br.pos++
              }
            }
            coef.fill(0)
            // DC
            const t = br.decodeHuff(dcT)
            if (t < 0) throw new Error('huffman decode failed (DC)')
            let diff = 0
            if (t > 0) {
              const bits = br.read(t)
              diff = extend(bits, t)
            }
            const dc = (pred.get(comp.id) || 0) + diff
            pred.set(comp.id, dc)
            coef[0] = dc * qt[0]
            // AC
            let k = 1
            while (k < 64) {
              const rs = br.decodeHuff(acT)
              if (rs < 0) throw new Error('huffman decode failed (AC)')
              const r = rs >> 4; const s = rs & 15
              if (s === 0) {
                if (r === 15) { k += 16; continue } // ZRL
                break // EOB
              }
              k += r
              if (k > 63) break
              const bits = br.read(s)
              coef[ZIGZAG[k]] = extend(bits, s) * qt[k]
              k++
            }
            idct(coef, blk)
            // 写入组件平面（MCU 内块序：按 (by,bx) 交织）
            const px = (mx * comp.h + bx) * 8
            const py = (my * comp.v + by) * 8
            const pl = planes.find(p => p.c === comp)
            for (let y = 0; y < 8; y++) {
              const row = (py + y) * pl.w + px
              for (let x = 0; x < 8; x++) {
                pl.data[row + x] = clamp255(blk[y * 8 + x] + 128)
              }
            }
          }
        }
      }
      mcuCount++
    }
  }

  // ---------- 上采样 + 色彩转换 → RGBA ----------
  const out = new Uint8Array(width * height * 4)
  const yPlane = planes[0]; const cbPlane = planes[1]; const crPlane = planes[2]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      if (comps.length === 1) {
        const g = yPlane.data[Math.floor(y / vmax) * yPlane.w + Math.floor(x / hmax)]
        out[p] = g; out[p + 1] = g; out[p + 2] = g
      } else {
        const Y = sample(yPlane, x, y, hmax, vmax)
        const Cb = sample(cbPlane, x, y, hmax, vmax)
        const Cr = sample(crPlane, x, y, hmax, vmax)
        out[p] = clamp255(Y + 1.402 * (Cr - 128))
        out[p + 1] = clamp255(Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128))
        out[p + 2] = clamp255(Y + 1.772 * (Cb - 128))
      }
      out[p + 3] = 255
    }
  }
  if (exifOrientation !== 1) {
    const r = applyOrientation(width, height, out, exifOrientation)
    return { w: r.w, h: r.h, data: r.data, orientation: exifOrientation }
  }
  return { w: width, h: height, data: out, orientation: 1 }
}

/** 不解码像素，只扫描 APP1 取 EXIF Orientation（progressive 转码兜底时保留方向） */
export function readJpegOrientation (bytes) {
  if (!bytes || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return 1
  let pos = 2
  while (pos < bytes.length - 4) {
    if (bytes[pos] !== 0xFF) { pos++; continue }
    const marker = bytes[pos + 1]
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) { pos += 2; continue }
    if (marker === 0xD9 || marker === 0xDA) break
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3]
    if (len < 2) break
    if (marker === 0xE1) {
      const o = readExifOrientation(bytes.subarray(pos + 4, pos + 2 + len))
      if (o !== 1) return o
    }
    pos += 2 + len
  }
  return 1
}

/** 解析 APP1 段里的 EXIF Orientation（1~8；解析失败/不存在返回 1） */
function readExifOrientation (seg) {
  if (seg.length < 14) return 1
  if (!(seg[0] === 0x45 && seg[1] === 0x78 && seg[2] === 0x69 && seg[3] === 0x66 && seg[4] === 0 && seg[5] === 0)) return 1
  const t = 6
  const le = seg[t] === 0x49 && seg[t + 1] === 0x49
  if (le ? !(seg[t + 2] === 0x2A && seg[t + 3] === 0) : !(seg[t + 2] === 0 && seg[t + 3] === 0x2A)) return 1
  const rd16 = o => (le ? (seg[o] | (seg[o + 1] << 8)) : ((seg[o] << 8) | seg[o + 1]))
  const rd32 = o => (le
    ? ((seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0)
    : (((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0))
  const ifd = t + rd32(t + 4)
  if (ifd + 2 > seg.length) return 1
  const n = rd16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > seg.length) break
    if (rd16(e) === 0x0112) { // Orientation
      const v = rd16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

/** 按 EXIF Orientation 把像素转正（1 原样 / 2 水平镜像 / 3 180° / 4 垂直镜像 / 5~8 转置类） */
export function applyOrientation (w, h, data, orientation) {
  const swap = orientation >= 5
  const ow = swap ? h : w; const oh = swap ? w : h
  const out = new Uint8Array(ow * oh * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx; let ny
      switch (orientation) {
        case 2: nx = w - 1 - x; ny = y; break
        case 3: nx = w - 1 - x; ny = h - 1 - y; break
        case 4: nx = x; ny = h - 1 - y; break
        case 5: nx = y; ny = x; break
        case 6: nx = h - 1 - y; ny = x; break
        case 7: nx = h - 1 - y; ny = w - 1 - x; break
        case 8: nx = y; ny = w - 1 - x; break
        default: nx = x; ny = y
      }
      const sp = (y * w + x) * 4; const dp = (ny * ow + nx) * 4
      out[dp] = data[sp]; out[dp + 1] = data[sp + 1]; out[dp + 2] = data[sp + 2]; out[dp + 3] = data[sp + 3]
    }
  }
  return { w: ow, h: oh, data: out }
}

function sample (plane, x, y, hmax, vmax) {
  // box 复制上采样（标准行为）：源坐标 = 目标坐标 ÷ 采样因子比
  const px = Math.min(plane.w - 1, Math.floor(x / (hmax / plane.c.h)))
  const py = Math.min(plane.h - 1, Math.floor(y / (vmax / plane.c.v)))
  return plane.data[py * plane.w + px]
}

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10,
  17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
]

function extend (bits, s) {
  // JPEG magnitude-category 反变换
  if (bits < (1 << (s - 1))) return bits - (1 << s) + 1
  return bits
}
function clamp255 (v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v) }
