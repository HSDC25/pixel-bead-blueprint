/**
 * test/run.mjs — pixel-bead-blueprint 自动化测试（node:test，零依赖）
 *
 * 运行：node --test scripts/test/run.mjs
 * （或 node test/run.mjs —— 本文件两种跑法都支持）
 *
 * 判据来源：APP 已验证的验收标准（AGENTS.md「像素化/拼豆画质」节），不新造标准：
 *   T1  透明=空位：合成「透明底+纯红圆」⇒ 空格不出红、不产色号、用色数 ≤2
 *   T2  恒等性：不透明纯色图上，最近色映射结果与「直接对色盘逐色匹配」逐格一致
 *   T3  采购换算：212 颗 @200/包 ⇒ 2 包（余 12）；200 颗 ⇒ 1 包余 0
 *   T4  网格检测：合成 12×10 网格成品图（无间隙）⇒ detectGridByDiff 检出 cols/rows 近似 12/10
 *   T5  门禁：网格成品图放行（pass=true）；高斯渐变图拒绝（pass=false）
 *   T6  逐格取色：合成网格图取色 ⇒ 分桶后色数 ≤ 网格注入色数
 *   T7  PNG 编解码回环：encode→decode 逐字节一致（RGBA & RGB）
 *   T8  库存闭环：库存色限定生成 + 缺色分析（覆盖 % + 缺色清单）
 *   T9  超大档护栏：100MP 拒绝 + 8192 上限
 *   T10 处理报告：决策数据结构化（qstart/cells/emptyRatio 三行）
 *   T11 色号匹配置信度：ΔE≤5 高 / ≤12 中 / 其余低
 *   T12 工作流 B 全链路：合成成品图 → 门禁 → 网格 → 取色 → 色号 → 库存 → 限定生成
 *   T17 FS 抖动宽高比：短边 = grid（横图/竖图都不变形）
 *   T18 施工图纸画布：宽度 = 网格宽（图例不得撑宽画布，换行高度计入）
 *   T19 EXIF 方向：Orientation=6 ⇒ 解码后宽高互换（手机竖拍照片）
 *   T20 CLI 工作流 B：--scan 生成库存 JSON（含网格/证据）
 *   T21 CLI --analyze：stdout 为纯 JSON，--crop 生效
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const {
  Palette, quantizeToGrid, renderGridPng, purchaseList,
  synthTransparentRedCircle, synthGridImage,
  gateCheck, detectGridByDiff, extractColorsFromGrid, matchToPalette,
  saveInventory, loadInventory, buildLimitedPalette, missingColorAnalysis,
  encodePng, decodePng, rgbToLab, labDist2, ULTRA_MAX_PIXELS,
  regionClean, recountColors, quantizeWithDither, applyOutline, mergeCloseColors,
  renderBlueprintSheet, applyFlatPriority, renderAsciiMatrix, buildBlockIndex,
  detectGridByProjection, isSkinColor, flatFlipRate, extractSrcLabGrid, buildAdaptivePalette, evalGridQuality
} = await import(pathToFileURL(path.join(ROOT, 'references/quantize.mjs')).href)
const { decodeJpeg } = await import(pathToFileURL(path.join(ROOT, 'references/jpeg.mjs')).href)
const { availableProgressiveConverter } = await import(pathToFileURL(path.join(ROOT, 'references/jpeg-progressive.mjs')).href)
const { buildTeachingPlan, renderCoachingMarkdown } = await import(pathToFileURL(path.join(ROOT, 'references/teaching.mjs')).href)

/** 给 baseline JPEG 注入一个只含 Orientation 的 APP1 EXIF 段（模拟手机竖拍照片） */
function injectExifOrientation (jpeg, orientation) {
  const tiff = Buffer.alloc(26)
  tiff.write('MM\0*', 0, 'latin1')
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8)
  tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(orientation, 18)
  const exif = Buffer.from('Exif\0\0', 'latin1')
  const payLen = 2 + exif.length + tiff.length
  const app1 = Buffer.alloc(2 + payLen)
  app1[0] = 0xFF; app1[1] = 0xE1; app1.writeUInt16BE(payLen, 2); exif.copy(app1, 4); tiff.copy(app1, 10)
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)])
}

const palette = new Palette(JSON.parse(fs.readFileSync(path.join(ROOT, 'references/palette.mard.json'), 'utf-8')))

// ---------- T7 PNG 编解码回环（基础件，先测） ----------
test('T7 PNG 回环：RGBA 逐字节一致', () => {
  const img = synthTransparentRedCircle(64)
  const png = encodePng(img.w, img.h, img.data, 6)
  const back = decodePng(png)
  assert.equal(back.w, 64)
  assert.equal(back.h, 64)
  assert.deepEqual(Buffer.from(back.data).equals(Buffer.from(img.data)), true)
})

test('T7b PNG 回环：RGB(不透明) 编解码一致', () => {
  const img = synthGridImage(6, 6, 8, 0)
  const png = encodePng(img.w, img.h, img.data, 2)
  const back = decodePng(png)
  for (let i = 0; i < img.w * img.h; i++) {
    const s = i * 4; const d = i * 4
    assert.equal(back.data[d], img.data[s], `R@${i}`)
    assert.equal(back.data[d + 1], img.data[s + 1], `G@${i}`)
    assert.equal(back.data[d + 2], img.data[s + 2], `B@${i}`)
    assert.equal(back.data[d + 3], 255)
  }
})

// ---------- T1 透明=空位铁律 ----------
test('T1 透明=空位：透明底红圆 ⇒ 空格不渗色、不产色号', () => {
  const img = synthTransparentRedCircle(128)
  const { grid, paletteUsed, stats } = quantizeToGrid(img, palette, { grid: 24 })
  // 红圆存在 ⇒ 必有产出豆
  assert.ok(stats.beads > 0, '红圆区必产豆')
  // 用色数 ≤ 2（APP 判据：合成透明底+纯红圆 ⇒ 用色数 2→1，容忍至多 2）
  assert.ok(stats.colors <= 2, `用色数 ${stats.colors} 应 ≤2`)
  // 空位存在且比例显著（圆占面积 ≈ π*0.38² ≈ 45%，空位应 >40%）
  assert.ok(stats.empty / (stats.w * stats.h) > 0.4, `空位率 ${(stats.empty / (stats.w * stats.h) * 100).toFixed(1)}% 应 >40%`)
  // 空位不产色号：paletteUsed 全部来自红圆
  for (const c of paletteUsed) {
    const [r, g, b] = c.rgb
    assert.ok(r > 150 && g < 100 && b < 100, `色 ${c.code} RGB(${r},${g},${b}) 应为红色系`)
  }
})

// ---------- T2 恒等性 ----------
test('T2 恒等性：不透明纯色图 ⇒ 逐格 = 直接最近色匹配', () => {
  const img = synthGridImage(4, 4, 16, 0)
  const { grid, paletteUsed } = quantizeToGrid(img, palette, { grid: 4 })
  // 每格均值 = 该纯色本身 ⇒ quantize 结果 = palette.nearest(该色)
  const seen = new Set()
  for (let i = 0; i < grid.length; i++) {
    const idx = grid[i]
    assert.ok(idx >= 0, '不透明图无空位')
    seen.add(idx)
  }
  assert.equal(seen.size, paletteUsed.length)
  // 手工对每个注入色做最近色匹配，比对色号集合一致
  const injected = [[230, 57, 70], [29, 53, 87], [42, 157, 143], [255, 183, 3], [0, 0, 0]]
  const expectedCodes = injected.map(c => palette.nearest(c[0], c[1], c[2]).code)
  for (const code of expectedCodes) {
    assert.ok(paletteUsed.some(p => p.code === code), `注入色最近色 ${code} 应出现在结果`)
  }
})

// ---------- T3 采购换算 ----------
test('T3 采购换算：212颗@200/包⇒2包余12；200颗⇒1包余0', () => {
  const list = purchaseList([
    { code: 'H7', hex: 'FF0000', rgb: [255, 0, 0], count: 212, share: 1 },
    { code: 'H8', hex: '00FF00', rgb: [0, 255, 0], count: 200, share: 1 }
  ], 200)
  assert.equal(list[0].packs, 2)
  assert.equal(list[0].remainder, 12)
  assert.equal(list[1].plan_packs ?? list[1].packs, 1)
  assert.equal(list[1].remainder, 0)
})

// ---------- T4 网格检测 ----------
test('T4 网格检测：12×10 无间隙网格图 ⇒ 检出近似 12/10', () => {
  const img = synthGridImage(12, 10, 20, 0)
  const gi = detectGridByDiff(img)
  assert.ok(gi !== null, '应检出网格')
  assert.ok(Math.abs(gi.cols - 12) <= 2, `cols=${gi.cols} 应≈12`)
  assert.ok(Math.abs(gi.rows - 10) <= 2, `rows=${gi.rows} 应≈10`)
})

// ---------- T5 门禁 ----------
test('T5 门禁：成品网格图放行', () => {
  const img = synthGridImage(12, 10, 20, 0)
  const g = gateCheck(img)
  assert.equal(g.pass, true, g.report)
})

test('T5b 门禁：渐变照片风图拒绝', () => {
  const size = 160
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4
      data[p] = (x * 255) / size          // 水平渐变
      data[p + 1] = (y * 255) / size      // 垂直渐变
      data[p + 2] = 128
      data[p + 3] = 255
    }
  }
  const g = gateCheck({ w: size, h: size, data })
  assert.equal(g.pass, false, `渐变图应被拒：${g.report}`)
})

// ---------- T6 逐格取色 ----------
test('T5c 门禁：透明底像素画按不透明像素计，不因空位被误拒', () => {
  const img = synthTransparentRedCircle(128)
  const g = gateCheck(img)
  assert.equal(g.pass, true, g.report)
  assert.ok(g.flatRatio > 0.99, `flatRatio ${g.flatRatio} 应 ≈1（空位不计入分母）`)
})

test('T6 逐格取色：分桶归并 ⇒ 色数 ≤ 注入色数', () => {
  const img = synthGridImage(10, 10, 20, 0)
  const gi = detectGridByDiff(img)
  assert.ok(gi)
  const { colors } = extractColorsFromGrid(img, gi)
  assert.ok(colors.length > 0)
  assert.ok(colors.length <= 5, `分桶后 ${colors.length} 色应 ≤5 注入色`)
})

// ---------- T8 库存闭环 ----------
test('T8 库存闭环：限定生成 + 缺色分析', () => {
  const img = synthGridImage(4, 4, 16, 0)
  const { paletteUsed } = quantizeToGrid(img, palette, { grid: 4 })
  // 取前 2 色为库存
  const stock = paletteUsed.slice(0, 2).map(c => c.code)
  const inv = saveInventory(stock, path.join(__dirname, 'tmp-inventory.json'), fs)
  assert.equal(inv.codes.length, 2)
  const loaded = loadInventory(path.join(__dirname, 'tmp-inventory.json'), fs)
  assert.deepEqual(loaded.codes, stock)
  // 限定色盘只含库存色
  const limited = buildLimitedPalette(palette, loaded.codes)
  assert.equal(limited.colors.length, 2)
  // 用限定色盘重新量化 ⇒ 结果色号 ⊆ 库存
  const re = quantizeToGrid(img, limited, { grid: 4 })
  for (const c of re.paletteUsed) assert.ok(stock.includes(c.code), `${c.code} 应在库存内`)
  // 缺色分析
  const miss = missingColorAnalysis(paletteUsed, stock)
  assert.equal(miss.coveredCount, 2)
  assert.ok(miss.missing.length >= 0)
  assert.ok(miss.report.includes('覆盖'))
})

// ---------- T9 超大档护栏 ----------
test('T9 100MP 护栏：超限抛可读错误', () => {
  const fake = { w: 12000, h: 12000, data: new Uint8Array(4) } // 144MP > 100MP
  assert.throws(() => quantizeToGrid(fake, palette, { grid: 64 }), /100MP/)
})

test('T9b 网格上限：grid>8192 拒绝', () => {
  const img = synthGridImage(4, 4, 8, 0)
  assert.throws(() => quantizeToGrid(img, palette, { grid: 9000 }), /8192/)
})

// ---------- T10 处理报告 ----------
test('T10 处理报告：结构化决策数据', () => {
  const img = synthGridImage(4, 4, 16, 0)
  const { stats } = quantizeToGrid(img, palette, { grid: 4 })
  assert.ok(stats.decisions.some(d => d.startsWith('qstart')))
  assert.ok(stats.decisions.some(d => d.startsWith('cells ')))
  assert.ok(stats.decisions.some(d => d.startsWith('emptyRatio=')))
  assert.ok(stats.elapsedMs >= 0)
})

// ---------- T11 置信度分级 ----------
test('T11 置信度：ΔE≤5 high / ≤12 medium / >12 low', () => {
  const near = matchToPalette([[252, 252, 252]], palette)   // 近白 ⇒ 某白号 ΔE 小
  assert.equal(near[0].confidence, 'high')
  // 人为构造远色：找色盘中最大 ΔE 的合成色（补 255,0,255 品红——221 色中必无完全一致）
  const far = matchToPalette([[255, 0, 255]], palette)
  assert.ok(['medium', 'low'].includes(far[0].confidence))
})

// ---------- T12 工作流 B 全链路 ----------
test('T12 工作流 B 全链路：成品图 → 门禁 → 网格 → 取色 → 色号 → 库存 → 限定', () => {
  const img = synthGridImage(12, 10, 20, 0)
  const gate = gateCheck(img)
  assert.equal(gate.pass, true)
  const gi = detectGridByDiff(img)
  assert.ok(gi)
  const { colors } = extractColorsFromGrid(img, gi)
  const matched = matchToPalette(colors, palette)
  assert.ok(matched.length > 0)
  // 色号 → 库存 → 限定盘 → 限量重出
  const stock = matched.map(m => m.code)
  const limited = buildLimitedPalette(palette, stock)
  const re = quantizeToGrid(img, limited, { grid: 12 })
  for (const c of re.paletteUsed) assert.ok(stock.includes(c.code))
  // 渲染直映 PNG 不炸
  const png = renderGridPng(re.grid, re.stats.w, re.stats.h, limited)
  assert.ok(png.length > 100)
  const back = decodePng(png)
  assert.equal(back.w, re.stats.w)
})

// ---------- 附加：Lab 数学正确性抽查（对照已知值） ----------
test('T13 Lab 数学：纯白 RGB(255,255,255) ⇒ L=100 a≈0 b≈0', () => {
  const [L, a, b] = rgbToLab([255, 255, 255])
  assert.ok(Math.abs(L - 100) < 0.1, `L=${L}`)
  assert.ok(Math.abs(a) < 0.5)
  assert.ok(Math.abs(b) < 0.5)
})

test('T14 超大档 8192 真跑：67M 格量化 + 直映 PNG + 分块索引 + 抽块 sheet（2026-10-22 名实修正）', () => {
  // ⚠️ 曾用 1024 冒充 8192（名实不符被复核表定罪）——本测试真跑 8192 全链路。
  // 源图 64×64 纯色块（合成，网格语义上 8192 是超采样）⇒ 量化的瓶颈是格数本身。
  const img = synthGridImage(16, 16, 4, 0) // 64×64
  const t0 = Date.now()
  const { grid, paletteUsed, stats } = quantizeToGrid(img, palette, { grid: 8192 })
  const qMs = Date.now() - t0
  // 网格对齐：8192 / 4 = 2048 每源格（短边口径：64→8192 即 grid=8192）
  assert.ok(stats.w === 8192 || stats.h === 8192, `短边应=8192，实际 ${stats.w}x${stats.h}`)
  assert.equal(stats.w * stats.h, 8192 * 8192, '总格数应 67M')
  assert.ok(stats.beads > 0)
  // 直映 PNG（scale=1）
  const t1 = Date.now()
  const png = renderGridPng(grid, stats.w, stats.h, palette, 1)
  const pMs = Date.now() - t1
  assert.ok(png.length > 1000, '8192 直映 PNG 应有实际内容')
  // 分块索引（超大档设计形态：索引 + 按需抽块，不出全量 sheet）
  const t2 = Date.now()
  const idx = buildBlockIndex(grid, stats.w, stats.h, palette, 512, 3)
  const iMs = Date.now() - t2
  assert.ok(idx.blocks.length > 0, '分块索引应有块')
  assert.ok(idx.blocks.length <= Math.ceil(stats.w / 512) * Math.ceil(stats.h / 512) + 1)
  // 抽 1 块渲染 sheet 证明「按需展开」可用（cellPx 下限 22）
  // ⚠️ buildBlockIndex 字段是 row0/col0（1 起）+ rows/cols——不是 x/y/w/h（写错会 NaN 被本测试抓过）
  const b0 = idx.blocks[0]
  const bx0 = b0.col0 - 1; const by0 = b0.row0 - 1
  const block = new Int16Array(b0.cols * b0.rows)
  for (let y = 0; y < b0.rows; y++) {
    for (let x = 0; x < b0.cols; x++) block[y * b0.cols + x] = grid[(by0 + y) * stats.w + (bx0 + x)]
  }
  const t3 = Date.now()
  const sheetB = renderBlueprintSheet(block, b0.cols, b0.rows, palette, 22)
  const sMs = Date.now() - t3
  assert.ok(sheetB.length > 500, '抽块 sheet 应可渲染')
  console.log(`    T14: 量化 ${qMs}ms | PNG ${pMs}ms | 索引 ${iMs}ms（${idx.blocks.length} 块）| 抽块 sheet ${sMs}ms | colors=${stats.colors} beads=${stats.beads}`)
  // 耗时护栏：全链路 <60s（CI 可容忍）；超了说明 nearestLab 缓存失效或渲染退化
  assert.ok(qMs + pMs + iMs + sMs < 60000, `8192 全链路 ${qMs + pMs + iMs + sMs}ms 应 <60s`)
})

// ---------- T15 平色（regionClean，2026-10-21 第二阶段） ----------
test('T15 平色：透明底红圆保形（豆数/空位不变——平色不吞主体不吞空位）', () => {
  const img = synthTransparentRedCircle(128)
  const r = quantizeToGrid(img, palette, { grid: 24 })
  const before = { beads: r.stats.beads, empty: r.stats.empty, colors: r.stats.colors }
  const rc = regionClean(r.grid, r.stats.w, r.stats.h, 2)
  const rc2 = recountColors(rc.grid, r.stats.w, r.stats.h, palette)
  // 铁律：空位不参与不扩散——空位数必须不变
  assert.equal(rc2.stats.empty, before.empty, `空位 ${before.empty} → ${rc2.stats.empty}（空位不许被动）`)
  // 保形：豆数保留率 >90%（红圆边缘被平滑是预期，吞主体不是）
  assert.ok(rc2.stats.beads / before.beads > 0.9, `豆数保留率 ${(rc2.stats.beads / before.beads * 100).toFixed(1)}% 应 >90%`)
  // 红圆本来就 1 色，平色后仍 1 色
  assert.equal(rc2.stats.colors, 1)
})

test('T15b 平色：归并孤点（合成孤点图 ⇒ 强力档吞掉孤立异色格）', () => {
  // 8×8 全同色 + 中心 1 格异色 = 孤点；强力档（≥5 邻居同色）必吞
  const N = 8
  const grid = new Int16Array(N * N)
  for (let i = 0; i < N * N; i++) grid[i] = 10 // 色盘 idx 10
  grid[4 * N + 4] = 200 // 孤立异色格
  const rc = regionClean(grid, N, N, 2)
  assert.equal(rc.grid[4 * N + 4], 10, '强力档应吞掉孤立异色格')
  assert.ok(rc.merged >= 1)
  // 标准档（≥6）也吞（8 邻居全同色）
  const rc1 = regionClean(grid, N, N, 1)
  assert.equal(rc1.grid[4 * N + 4], 10, '标准档也应吞掉（8/8 邻居同色）')
})

test('T15c 平色：level=0 恒等（关 = 原样返回）', () => {
  const img = synthGridImage(6, 6, 8, 0)
  const r = quantizeToGrid(img, palette, { grid: 6 })
  const rc = regionClean(r.grid, r.stats.w, r.stats.h, 0)
  assert.equal(rc.merged, 0)
  assert.equal(rc.grid, r.grid) // 同引用 = 未动
})

// ---------- T16 画质三件套（2026-10-21 第二阶段） ----------
test('T16 FS 抖动：透明底红圆空位零扩散（误差不进空位）', () => {
  const img = synthTransparentRedCircle(128)
  const r = quantizeWithDither(img, palette, { grid: 24 })
  // 空位数与 nearest 相同（抖动不许改变空位判定）
  const rn = quantizeToGrid(img, palette, { grid: 24 })
  assert.equal(r.stats.empty, rn.stats.empty, `空位 fs=${r.stats.empty} nearest=${rn.stats.empty}（抖动不许动空位）`)
  assert.ok(r.stats.beads > 0)
})

test('T16b 边缘描边：不吞空位不增减格子（描边只加深不变形状）', () => {
  const img = synthGridImage(8, 8, 12, 0)
  const r = quantizeToGrid(img, palette, { grid: 8 })
  const before = { empty: r.stats.empty, beads: r.stats.beads }
  const ol = applyOutline(r.grid, r.stats.w, r.stats.h, palette)
  const rc2 = recountColors(ol.grid, r.stats.w, r.stats.h, palette)
  assert.equal(rc2.stats.empty, before.empty)
  assert.equal(rc2.stats.beads, before.beads)
})

test('T16c ΔE 归并：颗数守恒（归并 = 换色号，不删格子）', () => {
  const img = synthGridImage(8, 8, 12, 0)
  const r = quantizeToGrid(img, palette, { grid: 8 })
  const before = { colors: r.stats.colors, beads: r.stats.beads }
  const mc = mergeCloseColors(r.grid, r.stats.w, r.stats.h, palette, { deLimit: 12, lowShare: 0.05 })
  assert.equal(mc.stats.beads, before.beads, `豆数 ${before.beads} → ${mc.stats.beads}（归并不丢豆）`)
  assert.ok(mc.stats.colors <= before.colors)
})

test('T16d 抖动+清理算法层共存不崩（CLI 层负责互斥）', () => {
  const img = synthGridImage(6, 6, 10, 0)
  const r = quantizeWithDither(img, palette, { grid: 6, intensity: 0.5 })
  const rc = regionClean(r.grid, r.stats.w, r.stats.h, 2)
  assert.ok(rc.grid.length === r.grid.length)
})

test('T16e REPORT 方案 1 护栏：fs+护栏的平坦翻转率 ≤ nearest 基线（裸 fs 会爆炸）', () => {
  // 反事实三态（判例法 REPORT.md §二.A.4 同构实验）：
  //   裸 fs（flat=false）翻转率应显著高于 fs+护栏；fs+护栏应 ≈ nearest 基线。
  const img = synthGridImage(16, 12, 24, 0) // 有渐变的合成图（cells 内不同色块）
  const gw = 64; const gh = 48
  const srcLab = extractSrcLabGrid(img, gw, gh)
  const rBare = quantizeWithDither(img, palette, { grid: 64, flat: false })
  const rGuard = quantizeWithDither(img, palette, { grid: 64 }) // 默认开护栏
  const rNear = quantizeToGrid(img, palette, { grid: 64 })
  const fBare = flatFlipRate(srcLab, rBare.grid, rBare.stats.w, rBare.stats.h, palette)
  const fGuard = flatFlipRate(srcLab, rGuard.grid, rGuard.stats.w, rGuard.stats.h, palette)
  const fNear = flatFlipRate(srcLab, rNear.grid, rNear.stats.w, rNear.stats.h, palette)
  // 护栏生效判据（REPORT 实测同构：38.64%→4.33%≈关抖动值）
  assert.ok(fGuard.rate <= fNear.rate + 2, `护栏翻转率 ${fGuard.rate}% 应 ≤ nearest 基线 ${fNear.rate}%+2`)
  // 裸 fs 在平色网格图上翻转率显著更高（合成纯色块图上抖动误差全部是「多余翻转」）
  assert.ok(fBare.rate >= fGuard.rate, `裸 fs ${fBare.rate}% 应 ≥ 护栏 ${fGuard.rate}%`)
})

test('T18 adaptive 候选集：受限集内映射 + 色数不超 N + 翻转率不劣化（REPORT 方案 4）', () => {
  const img = synthGridImage(12, 10, 20, 0)
  const ap = buildAdaptivePalette(img, palette, 8)
  assert.ok(ap.colors.length <= 8 && ap.colors.length > 0, `受限集 ${ap.colors.length} 色应 ≤8 且 >0`)
  // 受限集内的色号必须是原色盘真色号
  for (const c of ap.colors) {
    assert.ok(palette.colors.some(p => p.code === c.code), `色号 ${c.code} 应来自原色盘`)
  }
  // 用受限集量化：结果色号 ⊆ 受限集
  const r = quantizeToGrid(img, ap, { grid: 24 })
  for (const c of r.paletteUsed) {
    assert.ok(ap.colors.some(p => p.code === c.code), `输出色号 ${c.code} 应在受限集内`)
  }
  // 翻转率不劣化（合成纯色块图上 adaptive 应优于全色盘——REPORT 实测同构 4.33%→1.52%）
  const srcLab = extractSrcLabGrid(img, r.stats.w, r.stats.h)
  const fAd = flatFlipRate(srcLab, r.grid, r.stats.w, r.stats.h, ap)
  const rFull = quantizeToGrid(img, palette, { grid: 24 })
  const fFull = flatFlipRate(srcLab, rFull.grid, rFull.stats.w, rFull.stats.h, palette)
  assert.ok(fAd.rate <= fFull.rate + 1, `adaptive ${fAd.rate}% 应 ≤ 全色盘 ${fFull.rate}%+1`)
  // ⚠️ 诚实边界（2026-10-22 实测）：渐变图（大浪类）adaptive 收益有限（13.57→13.25%）——
  //   主色连续分布时受限集仍有近邻对贴分界线；收益集中在主色结构简单的平色图。
})

// ---------- T17~T21（2026-10-22 照片实测回归） ----------
test('T17 FS 抖动宽高比：短边 = grid（横图/竖图都不变形）', () => {
  const land = synthGridImage(12, 8, 10, 0) // 120x80
  const rl = quantizeWithDither(land, palette, { grid: 64 })
  assert.equal(rl.stats.h, 64, '横图短边（高）应 = grid')
  assert.equal(rl.stats.w, Math.round(64 * land.w / land.h), '横图长边应 = grid × ratio')
  const port = synthGridImage(8, 12, 10, 0) // 80x120
  const rp = quantizeWithDither(port, palette, { grid: 64 })
  assert.equal(rp.stats.w, 64, '竖图短边（宽）应 = grid')
  assert.equal(rp.stats.h, Math.round(64 * port.h / port.w), '竖图长边应 = grid × ratio')
})

test('T18 施工图纸画布：宽度 = 网格宽（图例不撑宽画布，换行高度计入）', () => {
  const gw = 96; const gh = 40; const cellPx = 24
  const arr = new Int16Array(gw * gh).fill(0)
  const legend = Array.from({ length: 50 }, (_, i) => ({
    code: palette.colors[i].code, hex: palette.colors[i].hex, rgb: palette.colors[i].rgb, count: i + 1
  }))
  const png = renderBlueprintSheet(arr, gw, gh, palette, cellPx, { legend })
  const GUTTER = 3 * 6 + 6
  assert.equal(png.readUInt32BE(16), GUTTER + gw * cellPx + 2, '画布宽必须由网格决定')
  assert.ok(png.readUInt32BE(20) > GUTTER + gh * cellPx + 2, '图例换行高度必须计入画布高')
})

test('T18b 施工图纸列号可见：顶部编号栏有字（不能被格子覆盖）', () => {
  const gw = 10; const gh = 10; const cellPx = 24
  const arr = new Int16Array(gw * gh).fill(0)
  const png = renderBlueprintSheet(arr, gw, gh, palette, cellPx, {})
  const img = decodePng(png)
  const GUTTER = 3 * 6 + 6
  let inkTop = 0
  for (let y = 0; y < GUTTER; y++) {
    for (let x = GUTTER; x < img.w; x++) {
      const p = (y * img.w + x) * 4
      if (img.data[p] < 150) inkTop++
    }
  }
  assert.ok(inkTop > 0, '顶部编号栏应有列号像素（列号画在网格内会被格子覆盖）')
})

test('T19 EXIF 方向：Orientation=6 ⇒ 解码后宽高互换（手机竖拍照片）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/test/fixtures/mondrian-1930-cii-original.jpg'))
  const a = decodeJpeg(src)
  const b = decodeJpeg(injectExifOrientation(src, 6))
  assert.equal(a.orientation, 1)
  assert.equal(b.orientation, 6)
  assert.equal(b.w, a.h, 'orientation=6 输出宽应为原高')
  assert.equal(b.h, a.w, 'orientation=6 输出高应为原宽')
})

test('T20 CLI 工作流 B：--scan 生成库存 JSON（含网格/证据）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-scan-'))
  try {
    const img = synthGridImage(16, 12, 20, 0, palette.colors.slice(0, 12).map(c => c.rgb))
    const imgPath = path.join(tmp, 'grid.png')
    fs.writeFileSync(imgPath, encodePng(img.w, img.h, img.data, 6))
    const out = path.join(tmp, 'inv.json')
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), imgPath, '--scan', out], { stdio: 'pipe' })
    const doc = JSON.parse(fs.readFileSync(out, 'utf-8'))
    assert.ok(Array.isArray(doc.codes) && doc.codes.length >= 10, `库存色号 ${doc.codes?.length} 应 ≥10`)
    assert.equal(doc.grid.cols, 16)
    assert.equal(doc.grid.rows, 12)
    assert.ok(Array.isArray(doc.matches) && doc.matches.every(m => m.confidence === 'high'), '注入色盘原色应全 high 置信')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T21 CLI --analyze：stdout 为纯 JSON，--crop 生效', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-crop-'))
  try {
    const img = synthGridImage(20, 10, 10, 0)
    const imgPath = path.join(tmp, 'img.png')
    fs.writeFileSync(imgPath, encodePng(img.w, img.h, img.data, 6))
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), imgPath, '--analyze', '--crop', '10,10,100,50'], { encoding: 'utf-8' })
    const feat = JSON.parse(stdout) // 混入进度行会直接抛错
    assert.equal(feat.size, '100x50')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T22 内置色盘：Perler/Artkal/MARD291 加载即合法（schema 完整 + 短码唯一）', () => {
  for (const f of ['palette.perler.json', 'palette.artkal-c197.json', 'palette.artkal-m221.json', 'palette.mard291.json']) {
    const p = new Palette(JSON.parse(fs.readFileSync(path.join(ROOT, 'references', f), 'utf-8')))
    assert.ok(p.colors.length >= 100, `${f} 色数 ${p.colors.length} 应 ≥100`)
    const codes = new Set(p.colors.map(c => c.code))
    assert.equal(codes.size, p.colors.length, `${f} 短码必须唯一`)
    for (const c of p.colors) {
      assert.ok(/^[0-9A-F]{6}$/i.test(c.hex), `${f} ${c.code} hex 非法: ${c.hex}`)
      assert.ok(Number.isFinite(c.lab[0]), `${f} ${c.code} 缺 lab`)
    }
  }
  const perler = new Palette(JSON.parse(fs.readFileSync(path.join(ROOT, 'references/palette.perler.json'), 'utf-8')))
  assert.ok(perler.colors.some(c => c.fullCode && c.fullCode !== c.code), 'perler 应带产品号 fullCode')
})

test('T23 有间隙色卡：投影网格检测（gap≠0 仍检出且行列正确）', () => {
  const cell = 20; const gap = 6; const cols = 8; const rows = 6
  const w = cols * cell + (cols + 1) * gap; const h = rows * cell + (rows + 1) * gap
  const data = new Uint8Array(w * h * 4).fill(255) // 白底
  const rgbs = palette.colors.slice(0, cols * rows).map(c => c.rgb)
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const rgb = rgbs[r * cols + cIdx]
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const p = ((gap + r * (cell + gap) + y) * w + (gap + cIdx * (cell + gap) + x)) * 4
          data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2]; data[p + 3] = 255
        }
      }
    }
  }
  const gi = detectGridByProjection({ w, h, data })
  assert.ok(gi, '带间隙色卡应被投影检测检出')
  assert.equal(gi.cols, cols); assert.equal(gi.rows, rows)
  const { colors } = extractColorsFromGrid({ w, h, data }, gi)
  const matched = matchToPalette(colors, palette)
  const hit = rgbs.filter((_, i) => matched.some(m => m.code === palette.colors[i]?.code && m.confidence === 'high')).length
  assert.ok(hit >= cols * rows * 0.6, `取色命中 ${hit}/${cols * rows} 应 ≥60%`)
})

test('T24 敏感色优先：肤色灰会被拉回同色相族（候选集限制生效）', () => {
  const skinGray = [130, 110, 110]
  const img = { w: 8, h: 8, data: new Uint8Array(8 * 8 * 4) }
  for (let i = 0; i < 64; i++) {
    const p = i * 4
    img.data[p] = skinGray[0]; img.data[p + 1] = skinGray[1]; img.data[p + 2] = skinGray[2]; img.data[p + 3] = 255
  }
  const off = quantizeToGrid(img, palette, { grid: 8 })
  const on = quantizeToGrid(img, palette, { grid: 8, sensitive: true })
  const offCode = palette.colors[off.grid[0]].code
  const onCode = palette.colors[on.grid[0]].code
  assert.notEqual(offCode, onCode, `敏感色开关应有差异（off=${offCode} on=${onCode}）`)
  assert.ok(isSkinColor(...skinGray), 'RGB(130,110,110) 应被判为肤色系')
})

test('T25 平色优先：平坦区孤点被多数派吞掉（恒等性：无孤点时零改动）', () => {
  const gw = 12; const gh = 12
  const a = palette.colors[0]
  const b = palette.colors.find(c => Math.sqrt(labDist2(a.lab, c.lab)) > 1 && Math.sqrt(labDist2(a.lab, c.lab)) < 8)
  const grid = new Int16Array(gw * gh).fill(palette.colors.indexOf(a))
  grid[5 * gw + 5] = palette.colors.indexOf(b) // 单格近邻孤点
  const before = Int16Array.from(grid)
  const fp = applyFlatPriority(grid, gw, gh, palette, 1)
  assert.notEqual(fp.grid[5 * gw + 5], before[5 * gw + 5], '平坦区近邻孤点应被多数派归并')
  const uniform = new Int16Array(gw * gh).fill(palette.colors.indexOf(a))
  const fp2 = applyFlatPriority(uniform, gw, gh, palette, 1)
  assert.equal(fp2.changed, 0, '全平图零改动（恒等性）')
})

test('T26 ASCII 矩阵：表头 + 行数 + 空位标记正确', () => {
  const gw = 6; const gh = 4
  const grid = new Int16Array(gw * gh).fill(-1)
  grid[0] = palette.colors.indexOf(palette.colors[0])
  const txt = renderAsciiMatrix(grid, gw, gh, palette)
  const lines = txt.split('\n')
  assert.ok(lines[0].includes('6x4'), '首行应含网格尺寸')
  assert.ok(lines[0].includes(palette.name))
  const legendAt = txt.indexOf('# 色号图例')
  const body = txt.slice(0, legendAt)
  const dataRows = body.split('\n').filter(l => l && !l.startsWith('#')).length
  assert.equal(dataRows, gh, `数据行 ${dataRows} 应 = ${gh}（图例不计）`)
  const mEmpty = body.match(/空格 = (\.{2,})/)
  assert.ok(mEmpty, '表头应声明空位标记（空格 = …）')
  assert.ok(body.includes(mEmpty[1]), '数据行空位应使用声明标记')
})

test('T27 分块索引：块数/坐标/豆数闭合', () => {
  const gw = 10; const gh = 10
  const grid = new Int16Array(gw * gh).fill(palette.colors.indexOf(palette.colors[0]))
  const idx = buildBlockIndex(grid, gw, gh, palette, 4, 3)
  assert.equal(idx.blocksX, 3); assert.equal(idx.blocksY, 3); assert.equal(idx.total, 9)
  const beadSum = idx.blocks.reduce((s, b) => s + b.beads, 0)
  assert.equal(beadSum, gw * gh, '各块豆数之和应 = 总格数（全实心图）')
  const b1 = idx.blocks[0]
  assert.equal(b1.block, 1); assert.equal(b1.row0, 1); assert.equal(b1.col0, 1)
  assert.ok(b1.top.length > 0 && b1.top[0].count === b1.beads, '块 1 主色 top1 应等于块豆数（单色图）')
})

test('T28 CLI --teach：coaching.md 落盘且含辅导计划要素', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-teach-'))
  try {
    const img = synthGridImage(16, 16, 16, 0)
    const imgPath = path.join(tmp, 'img.png')
    fs.writeFileSync(imgPath, encodePng(img.w, img.h, img.data, 6))
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), imgPath, '--grid', '16', '--split', '16', '--teach', '--out', tmp], { stdio: 'pipe' })
    const coaching = fs.readFileSync(path.join(tmp, 'coaching.md'), 'utf-8')
    for (const kw of ['难度评定', '工时与场次', '易错点', '打卡']) {
      assert.ok(coaching.includes(kw), `coaching.md 缺少「${kw}」段`)
    }
    assert.ok(coaching.includes('块 1'), '分块图场次应按块划分')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T29 辅导计划数据：难度评定可解释 + 工时可推算（beginner 显式指定）', () => {
  const plan = buildTeachingPlan({
    fileName: 'x.png', paletteName: 'T', w: 32, h: 32, colors: 6, beads: 1024, empty: 0,
    speckleRate: 0, top5Share: 99, dither: 'nearest', outline: false, sensitive: false,
    flat: false, splitSize: 0, blocks: null, level: 'auto', sessionMinutes: 60
  })
  assert.ok(plan.levelReasons.length >= 2, '难度评定必须给理由（禁黑盒）')
  assert.ok(plan.pace.hours > 0 && plan.pace.sessions >= 1)
  const forced = buildTeachingPlan({
    fileName: 'x.png', paletteName: 'T', w: 32, h: 32, colors: 6, beads: 1024, empty: 0,
    speckleRate: 0, top5Share: 99, dither: 'nearest', outline: false, sensitive: false,
    flat: false, splitSize: 0, blocks: null, level: 'beginner', sessionMinutes: 60
  })
  assert.ok(forced.levelReasons[0].includes('学员自报'), '显式档位不重评（只记录）')
  const md = renderCoachingMarkdown(plan)
  assert.ok(md.includes('# 拼豆辅导计划'), '渲染缺标题')
})

test('T30 progressive JPEG：自动转码 + EXIF 转正（无转换器环境跳过）', { skip: !availableProgressiveConverter() }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-pg-'))
  try {
    const fx = path.join(ROOT, 'scripts/test/fixtures/progressive-mondrian.jpg')
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), fx, '--analyze'], { encoding: 'utf-8' })
    const feat = JSON.parse(stdout)
    assert.equal(feat.size, '600x594', `progressive 样张（无 EXIF）应按存储尺寸 600x594，实际 ${feat.size}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T31 --analyze 主体代理：中心细节占比可测（中心密 vs 均匀两种图给出方向性差异）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-subj-'))
  try {
    // ① 中心噪点 + 平边：主体代理应 >1
    const W = 120; const H = 120
    const center = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4
        const inCenter = Math.abs(x - W / 2) < W * 0.2 && Math.abs(y - H / 2) < H * 0.2
        const v = inCenter ? ((x * 7 + y * 11) % 2 === 0 ? 20 : 235) : 128
        center[p] = v; center[p + 1] = v; center[p + 2] = v; center[p + 3] = 255
      }
    }
    const f1 = path.join(tmp, 'center.png')
    fs.writeFileSync(f1, encodePng(W, H, center, 6))
    const a1 = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), f1, '--analyze'], { encoding: 'utf-8' }))
    assert.ok(a1.subject, 'analyze 应含 subject 字段')
    assert.ok(a1.subject.ratio > 1.2, `中心密图 ratio ${a1.subject.ratio} 应 >1.2`)
    assert.ok(a1.hints.some(h => h.startsWith('subject-centered')), '应给 subject-centered 提示')
    // ② 全图棋盘：中心/边缘密度接近（ratio ≈ 1），不给方向性提示
    const uni = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4
        const v = ((x + y) % 2 === 0) ? 30 : 225
        uni[p] = v; uni[p + 1] = v; uni[p + 2] = v; uni[p + 3] = 255
      }
    }
    const f2 = path.join(tmp, 'uniform.png')
    fs.writeFileSync(f2, encodePng(W, H, uni, 6))
    const a2 = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), f2, '--analyze'], { encoding: 'utf-8' }))
    assert.ok(a2.subject.ratio > 0.6 && a2.subject.ratio < 1.6, `全图纹理 ratio ${a2.subject.ratio} 应≈1`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T32 RGB 缓存恒等：带缓存 vs noRgbCache 逐格一致（优化不得改结果）', () => {
  const img = synthGridImage(24, 18, 12, 0)
  const a = quantizeToGrid(img, palette, { grid: 32 })
  const b = quantizeToGrid(img, palette, { grid: 32, noRgbCache: true })
  assert.equal(a.grid.length, b.grid.length)
  for (let i = 0; i < a.grid.length; i++) assert.equal(a.grid[i], b.grid[i], `第 ${i} 格不一致`)
  assert.equal(JSON.stringify(a.paletteUsed), JSON.stringify(b.paletteUsed))
})

test('T33 CLI --compare-matrix：多方案对照图 + 指标表落盘', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-matrix-'))
  try {
    const img = synthGridImage(16, 16, 12, 0)
    const imgPath = path.join(tmp, 'img.png')
    fs.writeFileSync(imgPath, encodePng(img.w, img.h, img.data, 6))
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), imgPath, '--grid', '16',
      '--compare-matrix', '--matrix-variants', 'nearest,merge', '--out', tmp], { stdio: 'pipe' })
    for (const f of ['matrix-nearest.png', 'matrix-merge.png', 'compare-matrix.png', 'matrix.md', 'matrix.json']) {
      assert.ok(fs.existsSync(path.join(tmp, f)), `缺少 ${f}`)
    }
    const doc = JSON.parse(fs.readFileSync(path.join(tmp, 'matrix.json'), 'utf-8'))
    assert.deepEqual(doc.variants.map(v => v.variant), ['nearest', 'merge'])
    assert.ok(doc.variants.every(v => typeof v.flatFlipRate === 'number' && typeof v.colors === 'number'))
    const composite = decodePng(fs.readFileSync(path.join(tmp, 'compare-matrix.png')))
    assert.ok(composite.w > 100 && composite.h > 100, '对照拼图应有实际内容')
    const mdTxt = fs.readFileSync(path.join(tmp, 'matrix.md'), 'utf-8')
    assert.ok(mdTxt.includes('判读要点'), 'matrix.md 应含判读要点（给 AI 选版用）')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('T34 CLI --flatten：子目录平铺 + INDEX.md 重建（原 flatten.mjs 并入 CLI）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-flat-'))
  try {
    const img = synthGridImage(8, 8, 8, 0)
    const imgPath = path.join(tmp, 'img.png')
    fs.writeFileSync(imgPath, encodePng(img.w, img.h, img.data, 6))
    const sub = path.join(tmp, 'ex', 'demo-g8')
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), imgPath, '--grid', '8', '--out', sub], { stdio: 'pipe' })
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'run.mjs'), '--flatten', '--examples', path.join(tmp, 'ex')], { stdio: 'pipe' })
    assert.ok(fs.existsSync(path.join(tmp, 'ex', 'demo-g8-blueprint.json')), '平铺后应有前缀文件')
    assert.ok(!fs.existsSync(sub), '子目录应被清除')
    const index = fs.readFileSync(path.join(tmp, 'ex', 'INDEX.md'), 'utf-8')
    assert.ok(index.includes('| demo-g8 |'), 'INDEX.md 应含该图纸行')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

// ---------- T35~T37 简笔画保真三件套（2026-10-24） ----------
/** 构造图片对象（quantize* 直接吃 {w,h,data}） */
function makeImg (w, h, paint) {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y)
      const p = (y * w + x) * 4
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = c[3] ?? 255
    }
  }
  return { w, h, data }
}
const darkCount = (grid, palette) => {
  let n = 0
  for (const v of grid) if (v >= 0 && palette.colors[v].lab[0] < 30) n++
  return n
}

test('T35 主色桶墨线保真：细线（线宽 < 格宽）不被判成白底', () => {
  // 640×640 白底 + 8px 竖线/横线；grid 32 ⇒ 每格 20px，线只占 40% 像素（主色仍是白）
  const img = makeImg(640, 640, (x, y) => (Math.abs(x - 320) < 4 || Math.abs(y - 320) < 4) ? [0, 0, 0] : [255, 255, 255])
  const withInk = quantizeToGrid(img, palette, { grid: 32 })
  const noInk = quantizeToGrid(img, palette, { grid: 32, inkMin: 1 }) // 1 = 关掉墨线规则
  const nInk = darkCount(withInk.grid, palette)
  const nBare = darkCount(noInk.grid, palette)
  assert.ok(nInk >= 40, `墨线规则应保留十字线（暗格 ${nInk}，至少 2×32 格）`)
  assert.ok(nInk > nBare * 2, `墨线规则应显著多于纯主色桶（${nInk} vs ${nBare}）`)
})

test('T36 平色暗线保护：1 格宽黑线不被亮色多数派吞掉；孤立黑点照旧清掉', () => {
  const N = 16
  const white = palette.nearestIndex([255, 255, 255])
  const black = palette.nearestIndex([0, 0, 0])
  const line = new Int16Array(N * N).fill(white)
  for (let x = 0; x < N; x++) line[8 * N + x] = black // 贯穿的 1 格宽黑线
  const rcLine = regionClean(line, N, N, 1, palette)
  assert.equal(rcLine.grid[8 * N + 8], black, '线段（有暗邻居）不许被吞')
  const speck = new Int16Array(N * N).fill(white)
  speck[8 * N + 8] = black // 孤立黑点
  const rcSpeck = regionClean(speck, N, N, 1, palette)
  assert.equal(rcSpeck.grid[8 * N + 8], white, '孤立黑点没有暗邻居 ⇒ 照旧被清')
})

test('T37 区域锁定：大面积平色区的光照渐变归一个色号；小区块不动', () => {
  // 左半 = 红色缓慢渐变（模拟扫描件光照），右半 = 白；下边 2×2 的红点留作小区块
  const img = makeImg(640, 640, (x, y) => {
    if (x < 320) {
      const t = x / 320
      return [Math.round(225 - 18 * t), Math.round(20 + 30 * t), Math.round(30 + 15 * t)]
    }
    if (y > 600 && x > 600) return [225, 20, 30]
    return [255, 255, 255]
  })
  const before = quantizeToGrid(img, palette, { grid: 32 })
  const after = quantizeToGrid(img, palette, { grid: 32, regionLock: 12 })
  const leftSet = g => {
    const s = new Set()
    const w = 32; const h = 32
    for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) if (g[y * w + x] >= 0) s.add(g[y * w + x])
    return s
  }
  const b = leftSet(before.grid); const a = leftSet(after.grid)
  assert.ok(b.size >= 2, `构造应产生 ≥2 个红（实测 ${b.size}）`)
  assert.equal(a.size, 1, `锁定后整块红应只剩 1 个色号（实测 ${a.size}）`)
  assert.ok(after.stats.beads === before.stats.beads, '锁定不改豆数')
})

test('T38 自动迭代指标：lock+ink 组合分低于默认（大色块归一 + 断线下降）——--refine 选版依据', () => {
  const img = decodeJpeg(fs.readFileSync(path.join(ROOT, 'scripts/test/fixtures/mondrian-1930-cii-original.jpg')))
  const g0 = quantizeToGrid(img, palette, { grid: 48 })
  const g1 = quantizeToGrid(img, palette, { grid: 48, regionLock: 8, inkMin: 0.10 })
  const m0 = evalGridQuality(img, g0.grid, g0.stats.w, g0.stats.h, palette)
  const m1 = evalGridQuality(img, g1.grid, g1.stats.w, g1.stats.h, palette)
  assert.ok(m1.score < m0.score, `lock+ink 分 ${m1.score} 应 < 默认 ${m0.score}`)
  assert.ok(m1.flip < m0.flip, `翻转率 ${m1.flip}% 应 < ${m0.flip}%（区域锁定治大色块劈叉）`)
  assert.ok(m1.lineBreak <= m0.lineBreak, `断线率 ${m1.lineBreak} 应 ≤ ${m0.lineBreak}`)
})

test('T39 墨线相对判据：深色块（蓝）旁的黑线不被判成蓝底——绝对阈值的历史 bug 回归锁', () => {
  // 全蓝底 + 8px 黑横线；g32 每格 20px，线占跨线格 40%
  // 旧判据「比主色暗 ΔY≥60」对蓝底（Y≈70）失效（黑线只暗 70）⇒ 线在蓝块边缘整条断裂；
  // 2026-10-25 改相对判据 Y < 0.55×主色Y − 4 ⇒ 黑线（Y≈0）必被抓。
  const img = makeImg(640, 640, (x, y) => (Math.abs(y - 320) < 4) ? [0, 0, 0] : [0, 80, 200])
  const r = quantizeToGrid(img, palette, { grid: 32 })
  const dark = darkCount(r.grid, palette)
  assert.ok(dark >= 30, `跨线格应出线色（暗格 ${dark}，至少一条 32 格横线）`)
  // 不在线上的格保持蓝（墨线规则不许误伤）
  const blue = palette.nearestIndex(rgbToLab([0, 80, 200]))
  assert.equal(r.grid[2 * r.stats.w + 16], blue, '远离线的格应是蓝')
})

// 清理临时库存文件
test.after?.(() => {
  try { fs.unlinkSync(path.join(__dirname, 'tmp-inventory.json')) } catch {}
})
