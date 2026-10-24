#!/usr/bin/env node
/**
 * run.mjs — pixel-bead-blueprint CLI 入口：图片 → 拼豆图纸五件套（落盘）
 *
 * 用法：
 *   node scripts/run.mjs <输入图片> [--grid N] [--out 输出目录] [--palette 色盘json]
 * 例：
 *   node scripts/run.mjs scripts/test/fixtures/mondrian-1930-cii-original.jpg --grid 48
 *
 * 输出（写入 --out 目录，默认 ./pixel-bead-output/<输入名>-g<网格>/，落在当前工作目录）：
 *   blueprint.png   直映网格图（每格 1px；空位 alpha=0）
 *   blueprint.json  逐格色号矩阵（w/h/cells，-1=空位）
 *   blueprint.md    图纸文档：色号表 + 用色统计 + 采购清单 + 处理报告
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const R = p => path.join(__dirname, '..', 'references', p)
const { Palette, quantizeToGrid, quantizeWithDither, applyOutline, mergeCloseColors, renderGridPng, renderBlueprintSheet, renderCompare, regionClean, recountColors, purchaseList, decodePng, rgbToLab, labDist2, applyFlatPriority, renderAsciiMatrix, buildBlockIndex,
  gateCheck, detectGridByDiff, detectGridByProjection, extractColorsFromGrid, matchToPalette, saveInventory, buildLimitedPalette, flatFlipRate, extractSrcLabGrid, buildAdaptivePalette, evalGridQuality, locateDefects, renderReview, renderCompareMatrix } =
  await import(pathToFileURL(R('quantize.mjs')).href)
const { decodeJpeg, readJpegOrientation, applyOrientation } = await import(pathToFileURL(R('jpeg.mjs')).href)
const { convertProgressiveToPng } = await import(pathToFileURL(R('jpeg-progressive.mjs')).href)
const { analyzeImage } = await import(pathToFileURL(R('analyze.mjs')).href)
const { buildTeachingPlan, renderCoachingMarkdown } = await import(pathToFileURL(R('teaching.mjs')).href)

// ---------- 参数 ----------
const args = process.argv.slice(2)
const input = args[0]
// --flatten 是无输入模式（维护 assets/examples/ 平铺 + INDEX.md），提前分流
if (args.includes('--flatten')) {
  flattenExamples(getOpt2(args, '--examples', path.join(__dirname, '..', 'assets', 'examples')))
  process.exit(0)
}
if (!input) {
  console.error(`用法:
  node scripts/run.mjs <图片> [--analyze] [--grid N] [--crop x,y,w,h] [--dither nearest|fs] [--outline 1] [--clean 0|1|2]
                [--sensitive 1] [--flat 1] [--maxcolors N] [--adaptive N] [--palette mard|mard291|perler|artkal-c197|artkal-m221]
                [--sample dominant|avg] [--region-lock DE] [--lock-min 8]
                [--split N] [--block N] [--ascii auto|0|1] [--teach] [--level beginner|intermediate|advanced] [--session-minutes 90] [--out 目录]
                [--compare-matrix] [--matrix-variants nearest,fs,outline,merge]   # 一条命令多方案对照（AI 选版）
  node scripts/run.mjs <成品/色卡图> --scan <库存.json> [--cols N --rows N] [--accept-low-confidence]   # 工作流 B：提取库存色号
  node scripts/run.mjs <照片> --inventory <库存.json> [--limit-palette] [--grid N]      # 工作流 B：库存限定/缺色分析
  node scripts/run.mjs --flatten [--examples 目录]                                      # 维护：examples 平铺 + INDEX.md`)
  process.exit(1)
}
function getOpt2 (a, name, def) { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : def }
/** 平铺 examples 子目录 → 根目录前缀文件 + 重建 INDEX.md（原 flatten.mjs，2026-10-22 并入 CLI） */
function flattenExamples (EX) {
  if (!fs.existsSync(EX)) { console.error(`✗ examples 目录不存在：${EX}`); process.exit(1) }
  const dirs = fs.readdirSync(EX, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  if (dirs.length === 0) { console.log(`▶ ${EX} 无子目录，无需平铺`); return }
  const rows = []
  for (const d of dirs) {
    const full = path.join(EX, d)
    const files = fs.readdirSync(full)
    for (const f of files) {
      const src = path.join(full, f); const dst = path.join(EX, `${d}-${f}`)
      if (fs.existsSync(dst)) fs.unlinkSync(dst) // 重跑覆盖旧平铺产物（Windows rename 不保证覆盖）
      fs.renameSync(src, dst)
    }
    const jsonPath = path.join(EX, `${d}-blueprint.json`)
    let info = { w: '?', h: '?', colors: '?', beads: '?', empty: '?' }
    if (fs.existsSync(jsonPath)) {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
      const cnt = new Map()
      for (const c of j.cells) { if (c !== -1) cnt.set(c, (cnt.get(c) || 0) + 1) }
      let beads = 0
      for (const v of cnt.values()) beads += v
      info = { w: j.w, h: j.h, colors: cnt.size, beads, empty: j.w * j.h - beads }
    }
    const style = d.endsWith('-fs') ? 'FS 抖动' : d.endsWith('-outline') ? '边缘描边' : d.match(/-c\d+$/) ? `ΔE 归并(${d.match(/-c(\d+)$/)[1]}色目标)` : '默认'
    const hasSheet = files.includes('sheet.png')
    const hasSplit = files.some(f => f.startsWith('sheet-block-'))
    rows.push({ dir: d, ...info, style, sheet: hasSheet ? `${d}-sheet.png` : hasSplit ? `${d}-sheet-block-*.png` : '-' })
    fs.rmSync(full, { recursive: true, force: true })
  }
  const md = []
  md.push(`# 图纸总索引（examples 平铺，${new Date().toISOString().slice(0, 10)}）`)
  md.push('')
  md.push(`共 ${rows.length} 份图纸。施工图纸 = \`*-sheet.png\`（网格线+色号+图例）；效果预览 = \`*-blueprint.png\`；分块版 = \`*-sheet-block-NN.png\`。`)
  md.push('')
  md.push('| 图纸 | 网格 | 用色 | 出豆 | 空位 | 风格 | 施工图纸 |')
  md.push('|---|---|---|---|---|---|---|')
  for (const r of rows.sort((a, b) => a.dir.localeCompare(b.dir))) {
    md.push(`| ${r.dir} | ${r.w}×${r.h} | ${r.colors} | ${r.beads} | ${r.empty} | ${r.style} | ${r.sheet} |`)
  }
  fs.writeFileSync(path.join(EX, 'INDEX.md'), md.join('\n') + '\n', 'utf-8')
  console.log(`✔ 平铺完成：${rows.length} 份图纸 + INDEX.md，子目录已清`)
}
const getOpt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const grid = parseInt(getOpt('--grid', '64'), 10) // 默认 64（2026-10-21 第三次纠偏：48 偏保守，用户三次反馈要更大网格）
const cleanLevel = parseInt(getOpt('--clean', '1'), 10) // 0 关 / 1 标准 / 2 强力（默认 1——大面积色块要平色）
const splitSize = parseInt(getOpt('--split', '0'), 10) // 分块边长（格）；0 = 不分块
const blockSel = parseInt(getOpt('--block', '0'), 10) // >0 时只出该块（配合 --split）
const asciiMode = getOpt('--ascii', 'auto') // auto | 0 | 1
const ditherMode = getOpt('--dither', 'nearest') // nearest | fs（fs = Lab 域 FS 抖动）
const outlineOn = getOpt('--outline', '0') === '1' // 边缘描边（默认关——描边是风格选择，不是普适提升）
const maxColors = parseInt(getOpt('--maxcolors', '0'), 10) // >0 时启用 ΔE 色对归并压到目标色数
const sensitiveOn = getOpt('--sensitive', '0') === '1' // 肤色保护（同色相族候选集）
const adaptiveN = parseInt(getOpt('--adaptive', '0'), 10) // >0 = 自适应候选集 N 色（默认关——REPORT 方案 4，代价见 SKILL.md）
// --sample dominant|avg：逐格取样口径。dominant（默认）= 格内主色桶（APP cellDominantGrid 同口径），
//   细线/锐边不被平均成灰；avg = 旧的格内均值（对照实验用）。
const sampleMode = getOpt('--sample', 'dominant') === 'avg' ? 'avg' : 'dominant'
// --region-lock DE：区域锁定（默认关）。同一平色区（相邻色号 ΔE ≤ DE）大面积连通域只留一个色号。
//   治「大色块被缓慢光照渐变劈成 3 个近似色号」——几何图/平色插画/扫描件建议 8~14。
const regionLockDe = parseFloat(getOpt('--region-lock', '0')) || 0
const lockMinArea = parseInt(getOpt('--lock-min', '8'), 10)
// --ink-min 0.15：主色桶取样时「暗像素占比达到多少就把整格判为线色」。简笔画断线就调低到 0.10。
const inkMin = parseFloat(getOpt('--ink-min', '0.15'))
if (!(inkMin >= 0 && inkMin <= 1)) { console.error('✗ --ink-min 应在 0~1'); process.exit(1) }
// --flat 0/1/2：平坦区处理。⚠️ 默认值分层（2026-10-22，REPORT.md 方案 1 判例法）：
//   fs 模式默认 1（平坦直通+零扩散是抖动链必配护栏，裸 FS 累计误差爆炸——CLI 79% 翻转率实测）；
//   nearest 模式默认 0（直通只对误差扩散有意义）。--flat 0 在 fs 下 = 用户显式要裸抖动（对比实验）。
const flatLevel = parseInt(getOpt('--flat', ditherMode === 'fs' ? '1' : '0'), 10)
const cropSpec = getOpt('--crop', '') // x,y,w,h（源图像素；EXIF 转正之后的坐标）
const scanOut = getOpt('--scan', '') // 工作流 B：扫描成品/色卡图 → 写库存色盘 JSON 后退出
const scanCols = parseInt(getOpt('--cols', '0'), 10) // 工作流 B 兜底：自动检测失败时手动指定列数
const scanRows = parseInt(getOpt('--rows', '0'), 10) // 工作流 B 兜底：自动检测失败时手动指定行数
const inventoryPath = getOpt('--inventory', '') // 工作流 B：库存色盘 JSON；默认只做覆盖/缺色分析
const limitPalette = args.includes('--limit-palette') // 与 --inventory 连用：量化只在库存色子集内映射
const acceptLow = args.includes('--accept-low-confidence') // 工作流 B：允许低置信色号静默入库
const teachOn = args.includes('--teach') // AI 辅导：落盘 coaching.md（难度/工时/场次/易错点/辅导问题）
const teachLevel = getOpt('--level', 'auto') // auto | beginner | intermediate | advanced
const sessionMinutes = parseInt(getOpt('--session-minutes', '90'), 10)
const compareMatrix = args.includes('--compare-matrix') // 一条命令跑多方案出对照图（AI 选版）
const matrixVariants = getOpt('--matrix-variants', 'nearest,fs,outline,merge').split(',').map(s => s.trim()).filter(Boolean)
const PALETTE_ALIASES = {
  mard: 'palette.mard.json',
  mard221: 'palette.mard.json',
  mard291: 'palette.mard291.json',
  perler: 'palette.perler.json',
  perler118: 'palette.perler.json',
  artkal: 'palette.artkal-c197.json',
  'artkal-c197': 'palette.artkal-c197.json',
  'artkal-m221': 'palette.artkal-m221.json'
}
const paletteArg = getOpt('--palette', 'mard')
const palettePath = PALETTE_ALIASES[paletteArg.toLowerCase()] ? R(PALETTE_ALIASES[paletteArg.toLowerCase()]) : paletteArg
const outDir = getOpt('--out', path.join(process.cwd(), 'pixel-bead-output', `${path.basename(input, path.extname(input))}-g${grid}${maxColors > 0 ? `-c${maxColors}` : ''}${outlineOn ? '-outline' : ''}${ditherMode === 'fs' ? '-fs' : ''}`))

// ---------- 解码（按扩展名；内容探测兜底） ----------
function loadImg (file) {
  const bytes = fs.readFileSync(file)
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    try {
      return decodeJpeg(bytes)
    } catch (e) {
      if (!/progressive/i.test(e.message)) throw e
      // progressive JPEG：系统转换器转 PNG 再解码；EXIF 方向从原 JPEG 元数据补回
      const { png, tool } = convertProgressiveToPng(file)
      const img = decodePng(png)
      const orient = readJpegOrientation(bytes)
      if (orient > 1) {
        return { ...applyOrientation(img.w, img.h, img.data, orient), orientation: orient, convertedBy: tool }
      }
      return { ...img, orientation: 1, convertedBy: tool }
    }
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return decodePng(bytes)
  throw new Error(`无法识别图片格式（仅支持 JPEG/PNG）：${file}`)
}

/** 裁剪（--crop x,y,w,h，源图像素；EXIF 转正后的坐标，越界自动夹取） */
function cropImage (img, spec) {
  const [x, y, w, h] = spec.split(',').map(Number)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    throw new Error('--crop 格式应为 x,y,w,h（源图像素，w/h > 0）')
  }
  const x0 = Math.max(0, Math.min(img.w - 1, Math.round(x)))
  const y0 = Math.max(0, Math.min(img.h - 1, Math.round(y)))
  const cw = Math.max(1, Math.min(img.w - x0, Math.round(w)))
  const ch = Math.max(1, Math.min(img.h - y0, Math.round(h)))
  const out = new Uint8Array(cw * ch * 4)
  for (let yy = 0; yy < ch; yy++) {
    const src = ((y0 + yy) * img.w + x0) * 4
    out.set(img.data.subarray(src, src + cw * 4), yy * cw * 4)
  }
  return { w: cw, h: ch, data: out }
}

/** 工作流 B 兜底：按给定行列生成等距网格（相邻同色格无边界时的取样通道） */
function uniformGrid (w, h, cols, rows) {
  const colPeaks = []; const rowPeaks = []
  for (let i = 1; i < cols; i++) colPeaks.push(Math.round(i * w / cols))
  for (let i = 1; i < rows; i++) rowPeaks.push(Math.round(i * h / rows))
  return { cols, rows, colPeaks, rowPeaks }
}

/** 工作流 B：门禁 → 网格检测 → 逐格取色 → ΔE 匹配 → 库存色盘 JSON */
function runScan (img, palette, outFile) {
  const gate = gateCheck(img)
  console.log(`▶ 门禁: ${gate.report}`)
  console.log(`  分支: strict=${gate.branches.strictPass} sparse=${gate.branches.sparseLike} illust=${gate.branches.illustLike} pixelArt=${gate.branches.pixelArtLike}（unique=${gate.unique} flatRatio=${gate.flatRatio}）`)
  if (!gate.pass) {
    console.error('✗ 门禁拒绝：这不是网格化色块图（成品照 / 像素画作品图 / 色卡截图才算）。')
    console.error('  普通照片请改走工作流 A（去掉 --scan 直接生成图纸）；若要提取，请先裁剪/矫正为网格图。')
    process.exit(2)
  }
  let gi = detectGridByDiff(img)
  if (!gi) gi = detectGridByProjection(img)
  if (!gi && scanCols >= 2 && scanRows >= 2) {
    gi = uniformGrid(img.w, img.h, scanCols, scanRows)
    console.log(`▶ 网格: 自动检测失败，改用手动行列 ${scanCols}x${scanRows}（按等距取样；请核对是否与实际格数一致）`)
  } else if (!gi) {
    console.error('✗ 网格检测失败：未检出等距网格边界。建议 ① 裁剪到只有色块区 ② 转正拍摄角度 ③ 保证相邻格边界可见；')
    console.error('  像素画作品图常有相邻同色格（无可见边界）⇒ 请数清行列后加 --cols N --rows N 重跑。')
    process.exit(3)
  } else if (gi.mode === 'projection') {
    console.log(`▶ 网格: 投影检出 ${gi.cols}x${gi.rows}（有间隙色卡；背景占比 ${gi.bgShare}，列覆盖 ${gi.colCoverage} / 行覆盖 ${gi.rowCoverage}）`)
  } else {
    console.log(`▶ 网格: 检出 ${gi.cols}x${gi.rows}（列边界 ${gi.colPeaks.length} 条 / 行边界 ${gi.rowPeaks.length} 条）`)
  }
  const { colors, samples } = extractColorsFromGrid(img, gi)
  const matches = matchToPalette(colors, palette)
  const counts = { high: 0, medium: 0, low: 0 }
  for (const m of matches) counts[m.confidence]++
  console.log(`▶ 取色: ${samples.length} 格样本 → ${colors.length} 个色桶 | 置信度 high=${counts.high} medium=${counts.medium} low=${counts.low}`)
  console.log('')
  const hasProduct = matches.some(m => (m.fullCode && m.fullCode !== m.code) || m.name)
  console.log(hasProduct
    ? '| # | 取样 RGB | 色号 | 产品号 | 名称 | HEX | ΔE | 置信度 |'
    : '| # | 取样 RGB | 色号 | HEX | ΔE | 置信度 |')
  console.log(hasProduct ? '|---|----------|------|--------|------|-----|----|--------|' : '|---|----------|------|-----|----|--------|')
  matches.forEach((m, i) => {
    console.log(hasProduct
      ? `| ${i + 1} | (${m.rgb.join(',')}) | ${m.code} | ${m.fullCode || m.code} | ${m.name || ''} | #${m.hex} | ${m.dE} | ${m.confidence} |`
      : `| ${i + 1} | (${m.rgb.join(',')}) | ${m.code} | #${m.hex} | ${m.dE} | ${m.confidence} |`)
  })
  const low = matches.filter(m => m.confidence === 'low')
  if (low.length > 0 && !acceptLow) {
    console.error('')
    console.error(`⚠ ${low.length} 个色号置信度 low（ΔE>12）——按工作流 B 口径不得静默采信。`)
    console.error('  请人工确认（光照/反光/熨烫纹理都可能拉低置信度）；确认后加 --accept-low-confidence 重跑。')
    process.exit(4)
  }
  const codes = [...new Set(matches.map(m => m.code))]
  saveInventory(codes, outFile, fs, {
    source: path.basename(input),
    palette: palette.code,
    grid: { cols: gi.cols, rows: gi.rows, mode: gi.mode || 'diff' },
    samples: samples.length,
    legend: [...new Map(matches.map(m => [m.code, { code: m.code, fullCode: m.fullCode || m.code, name: m.name || '', hex: m.hex }])).values()],
    matches: matches.map(m => ({ code: m.code, dE: m.dE, confidence: m.confidence }))
  })
  console.log('')
  console.log(`✔ 库存色盘已写入 ${outFile}（${codes.length} 色：${codes.join(' ')}）`)
  console.log(`  下一步：node scripts/run.mjs <照片> --inventory ${path.basename(outFile)} [--limit-palette] --grid N`)
}
// --flatten 时 stdout 只留纯 JSON 无关，进度行无所谓

/** --compare-matrix：同图多方案（nearest/fs/outline/merge）各跑一遍 → 对照拼图 + 指标表（AI 选版） */
function runCompareMatrix () {
  fs.mkdirSync(outDir, { recursive: true })
  const entries = []
  const rowsOut = []
  for (const name of matrixVariants) {
    const fsMode = name === 'fs'
    const qOpts = { grid, sensitive: sensitiveOn, sample: sampleMode, regionLock: regionLockDe, lockMinArea, inkMin }
    if (flatLevel > 0) qOpts.flat = true // 不传 = 走默认护栏（FS 平坦直通默认开）
    const q = fsMode ? quantizeWithDither(img, palette, qOpts) : quantizeToGrid(img, palette, qOpts)
    let g = q.grid
    const w = q.stats.w; const h = q.stats.h
    if (!fsMode && cleanLevel > 0) g = regionClean(g, w, h, cleanLevel, palette).grid
    if (name === 'outline') g = applyOutline(g, w, h, palette).grid
    if (name === 'merge') {
      const target = maxColors > 0 ? maxColors : 24
      let guard = 0
      while (guard++ < 6) {
        const before = recountColors(g, w, h, palette).stats.colors
        if (before <= target) break
        const mc = mergeCloseColors(g, w, h, palette, { deLimit: 8 + guard * 4, lowShare: 0.03 + (guard - 1) * 0.02 })
        if (mc.stats.colors >= before) break
        g = mc.grid
      }
    }
    if (!fsMode && flatLevel > 0) g = applyFlatPriority(g, w, h, palette, flatLevel).grid
    const re = recountColors(g, w, h, palette)
    const used = re.paletteUsed
    const lowBeads = used.filter(c => c.count <= 2).reduce((s, c) => s + c.count, 0)
    const speckle = re.stats.beads > 0 ? lowBeads / re.stats.beads : 0
    const ff = flatFlipRate(extractSrcLabGrid(img, w, h), g, w, h, palette)
    const png = renderCompare(img, g, w, h, palette, 480)
    const file = `matrix-${name}.png`
    fs.writeFileSync(path.join(outDir, file), png)
    const rerun = name === 'fs' ? '--dither fs'
      : name === 'outline' ? '--outline 1'
        : name === 'merge' ? `--maxcolors ${maxColors > 0 ? maxColors : 24}`
          : ''
    entries.push({ label: name, png })
    rowsOut.push({
      variant: name, colors: re.stats.colors, beads: re.stats.beads,
      speckleRate: +(speckle * 100).toFixed(2), flatFlipRate: ff.rate, file,
      rerun: `--grid ${grid}${rerun ? ' ' + rerun : ''}${sensitiveOn ? ' --sensitive 1' : ''}${flatLevel > 0 ? ` --flat ${flatLevel}` : ''}${regionLockDe > 0 ? ` --region-lock ${regionLockDe}` : ''}${sampleMode === 'avg' ? ' --sample avg' : ''}`
    })
    console.log(`  ✔ ${name}: ${re.stats.colors} 色 / ${re.stats.beads} 颗 / 孤点率 ${(speckle * 100).toFixed(2)}% / 平坦翻转率 ${ff.rate}% → ${file}`)
  }
  const combined = renderCompareMatrix(entries)
  fs.writeFileSync(path.join(outDir, 'compare-matrix.png'), combined)
  const md = []
  md.push(`# 参数对照矩阵 — ${path.basename(input)}（grid ${grid}）`)
  md.push('')
  md.push('> 一条命令跑多方案。选版由 AI 看 `compare-matrix.png` + 下表指标决定，不是按分数自动选。')
  md.push('')
  md.push('| 方案 | 用色 | 颗数 | 孤点率 | 平坦翻转率 | 单张 | 复跑命令 |')
  md.push('|---|---|---|---|---|---|---|')
  for (const r of rowsOut) md.push(`| ${r.variant} | ${r.colors} | ${r.beads} | ${r.speckleRate}% | ${r.flatFlipRate}% | ${r.file} | \`${r.rerun}\` |`)
  md.push('')
  md.push('## 判读要点')
  md.push('')
  md.push('- **看细节保真**（主体形状/五官/文字）：nearest 与 fs 对比，fs 通常边缘更碎')
  md.push('- **看渐变纹理**：fs 有纹理但可能噪；nearest 干净但可能色带')
  md.push('- **看轮廓**：outline 让边界更明确，风格化更强')
  md.push('- **看采购压力**：merge 色数最少，但 ΔE 大会变色（对比时重点看主体区）')
  md.push('- **平坦翻转率**：越高 = 源上肉眼同色的相邻格被拆成两个色号（拼出来有斑驳感）')
  fs.writeFileSync(path.join(outDir, 'matrix.md'), md.join('\n') + '\n', 'utf-8')
  fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify({
    source: path.basename(input), grid, variants: rowsOut
  }, null, 2), 'utf-8')
  console.log(`✔ ${path.join(outDir, 'compare-matrix.png')}（${entries.length} 方案对照拼图，标签=方案名）`)
  console.log(`✔ ${path.join(outDir, 'matrix.md')}（指标表 + 判读要点 + 复跑命令）`)
  console.log(`▶ 选版：看图判断，选定后用表里的复跑命令出正式图纸`)
  process.exit(0)
}

// --analyze 时 stdout 只留纯 JSON（agent 可直接 JSON.parse），进度行改走 stderr
const analyzing = args.includes('--analyze')
const log = analyzing ? (...a) => console.error(...a) : (...a) => console.log(...a)
log(`▶ 输入: ${input}`)
let img = loadImg(input)
if (img.convertedBy) log(`▶ progressive JPEG：已用 ${img.convertedBy} 转 PNG 再解码（${img.w}x${img.h}）`)
const exifOrientation = img.orientation || 1
if (exifOrientation > 1) log(`▶ EXIF 方向 ${exifOrientation}：已按元数据转正为 ${img.w}x${img.h}`)
if (cropSpec) {
  img = cropImage(img, cropSpec)
  log(`▶ 裁剪: ${cropSpec} → ${img.w}x${img.h}（${(img.w * img.h / 1e6).toFixed(1)}MP）`)
}
log(`▶ 尺寸: ${img.w}x${img.h}（${(img.w * img.h / 1e6).toFixed(1)}MP）`)

// ---------- 复杂画面如实声明（用户裁定 2026-10-25：拼豆媒介表达力有限，必须提前说） ----------
{
  const feat = analyzeImage(img)
  const complexFlags = []
  if (feat.edgeDensity > 0.30) complexFlags.push(`边缘密度 ${feat.edgeDensity}（细节密集，低网格必丢形）`)
  if (feat.colorEntropy > 7.5) complexFlags.push(`色彩熵 ${feat.colorEntropy}（色彩丰富，压色必有偏色）`)
  if (feat.flatRatio < 0.25 && feat.edgeDensity > 0.22) complexFlags.push(`平色区占比仅 ${(feat.flatRatio * 100).toFixed(0)}%（少大面积纯色，出图易碎）`)
  if (complexFlags.length > 0) {
    log(`⚠ 复杂画面如实声明：${complexFlags.join('；')}。拼豆是「形」的工艺——此类源在有限格子内无法完整复现，`)
    log(`  预期落差需提前告知用户：建议先 --crop 主体 / 升网格 / 换简化重绘版，再决定是否继续。`)
  }
}

// ---------- --analyze 模式：只出特征报告（大模型推理的数据依据），不出图 ----------
if (analyzing) {
  const feat = analyzeImage(img)
  console.log(JSON.stringify(feat, null, 2))
  console.error('（以上为图像特征。agent 工作流：① 视觉看图理解构图/主体/风格 → ② 结合本特征数据推理网格档与参数 → ③ 带 --grid/--dither/... 重跑本 CLI → ④ 看 compare.png 与孤点诊断回调。本模块只测特征，不做决策——决策权在大模型。）')
  process.exit(0)
}

// ---------- 色盘 / 库存（工作流 B） ----------
let palette = new Palette(JSON.parse(fs.readFileSync(palettePath, 'utf-8')))
let inventory = null
if (inventoryPath) {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf-8'))
  if (!Array.isArray(inventory.codes) || inventory.codes.length === 0) {
    console.error(`✗ 库存文件没有 codes 数组：${inventoryPath}`)
    process.exit(1)
  }
  log(`▶ 库存: ${inventoryPath}（${inventory.codes.length} 色）`)
  if (limitPalette) {
    palette = buildLimitedPalette(palette, inventory.codes)
    log(`▶ 限定色盘: ${palette.name}（${palette.colors.length} 色——量化只在这些色内映射）`)
  }
}

// ---------- --scan 模式（工作流 B：成品照/像素画/色卡 → 库存色盘 JSON） ----------
if (scanOut && limitPalette) {
  console.error('✗ --scan 与 --limit-palette 不能同时使用（扫描要对着完整色盘匹配）')
  process.exit(1)
}
if (blockSel > 0 && splitSize < 16) {
  console.error('✗ --block 需与 --split N（N≥16）连用')
  process.exit(1)
}
if (scanOut) {
  runScan(img, palette, scanOut)
  process.exit(0)
}

// ---------- --compare-matrix：多方案对照（AI 选版），出图后退出 ----------
if (compareMatrix) runCompareMatrix()

// ---------- 自适应候选集（--adaptive N，默认关——REPORT 方案 4）----------
// 治 nearest 全色盘的 Voronoi 分界翻转（实测大浪 g96 基线 13.57%）。
// ⚠️ 代价须声明（见 SKILL.md）：候选被图像约束后可能拿不到用户手里真有的色号。
// ⚠️ 排序：在库存限定（--limit-palette）之后——两者互斥语义由「后到先得」裁定，
//   adaptive 会覆盖库存限定（若同用，提示用户）。scan 模式已提前 exit，不受影响。
if (adaptiveN > 0) {
  if (limitPalette) console.log('  ⚠ --adaptive 与 --limit-palette 同用：adaptive 将覆盖库存限定（建议二选一）')
  const tA = Date.now()
  const ap = buildAdaptivePalette(img, palette, adaptiveN, Math.min(64, grid))
  console.log(`▶ 自适应候选集: ${palette.colors.length} → ${ap.colors.length} 色（${Date.now() - tA}ms）⚠ 代价：色号被图像约束，可能不含你手里真有的色号`)
  palette = ap
}
log(`▶ 色盘: ${palette.name}（${palette.colors.length} 色） | 管线: ${ditherMode}${outlineOn ? ' + outline' : ''}${cleanLevel > 0 && ditherMode !== 'fs' ? ' + clean' + cleanLevel : ''}${sensitiveOn ? ' + sensitive' : ''}${flatLevel > 0 ? ' + flat' + flatLevel : ''}${maxColors > 0 ? ' + merge→' + maxColors : ''}`)

// ---------- 自动迭代选参（--refine，默认开 6 组上限；--refine 0 关） ----------
// WHY（2026-10-25 用户裁定）：多模态大模型在环的价值 = 反复对比图纸和原图做到「像画出来的」，
//   但靠人眼反复重跑太慢；机器测得准的部分（逐格 ΔE / 断线率 / 平坦翻转率）应自动迭代，
//   agent 只在闭环之上做视觉终审（ai-tutor-protocol §目检三轮）。
// 做法：参数阶梯自动试 N 组 → 每组算 evalGridQuality（score = 逐格ΔE + 30×断线率 + 0.5×翻转率）
//   → 选最低分进入后续管线（描边/清理/归并照旧）→ refine.md 落盘全部轮次指标。
// ⚠️ 只在 nearest 管线生效（fs 是渐变工具，区域锁定/墨线阶梯与抖动脉冲语义冲突）；
//    只在固定网格下可比（不把网格数放进阶梯——网格该由 agent 看 --analyze 推理，不是枚举）。
let effSample = sampleMode; let effLock = regionLockDe; let effInk = inkMin
const refineMax = parseInt(getOpt('--refine', '6'), 10)
if (refineMax > 0 && ditherMode === 'fs') {
  console.log('▶ 自动迭代(--refine): fs 抖动模式跳过（区域锁定/墨线阶梯只对 nearest 有意义）')
}
if (refineMax > 0 && ditherMode !== 'fs') {
  const ratio = img.w / img.h
  const gw0 = ratio >= 1 ? Math.round(grid * ratio) : grid
  const gh0 = ratio >= 1 ? grid : Math.round(grid / ratio)
  if (gw0 * gh0 > 2 * 1000 * 1000) {
    console.log(`▶ 自动迭代(--refine): ${gw0 * gh0} 格 > 200 万，跳过（评估成本 > 收益；请用 --analyze + --compare-matrix 人工选参）`)
  } else {
    const tR = Date.now()
    const base = { grid, sensitive: sensitiveOn }
    const lockV = regionLockDe > 0 ? regionLockDe : 8
    const inkV = 0.10
    const variants = [
      { label: 'given', over: {} },
      { label: `lock${lockV}`, over: { regionLock: lockV } },
      { label: `ink${inkV}`, over: { inkMin: inkV } },
      { label: `lock${lockV}+ink${inkV}`, over: { regionLock: lockV, inkMin: inkV } },
      { label: 'avg', over: { sample: 'avg' } }
    ].slice(0, refineMax)
    const rows = []
    for (const v of variants) {
      const q = quantizeToGrid(img, palette, { ...base, sample: sampleMode, regionLock: regionLockDe, lockMinArea, inkMin, ...v.over })
      const m = evalGridQuality(img, q.grid, q.stats.w, q.stats.h, palette)
      rows.push({ label: v.label, over: v.over, colors: q.stats.colors, ...m })
    }
    rows.sort((a, b) => a.score - b.score)
    const best = rows[0]
    for (const r of rows) {
      console.log(`  · ${r.label.padEnd(14)} 逐格ΔE ${r.cellDe}（p90 ${r.cellDeP90}）/ 断线率 ${(r.lineBreak * 100).toFixed(1)}% / 翻转 ${r.flip}% / ${r.colors} 色 → 分 ${r.score}`)
    }
    effSample = best.over.sample || sampleMode
    effLock = best.over.regionLock ?? regionLockDe
    effInk = best.over.inkMin ?? inkMin
    console.log(`★ 自动迭代选定 ${best.label}（分 ${best.score} 最低，${Date.now() - tR}ms）——最终管线以它继续；全部轮次见 refine.md`)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, 'refine.md'), [
      `# 自动迭代选参报告 — ${path.basename(input)}（grid ${grid}）`,
      '',
      `> 评分 = 逐格ΔE + 30×断线率 + 0.5×平坦翻转率（越低越好；断线率 = 期望出线的格输出了浅色）。`,
      `> 选定 **${best.label}**（分 ${best.score}）。复跑命令：\`node scripts/run.mjs <图> --grid ${grid}${effLock > 0 ? ` --region-lock ${effLock}` : ''}${effSample === 'avg' ? ' --sample avg' : ''}${effInk !== 0.15 ? ` --ink-min ${effInk}` : ''}\``,
      '',
      '| 方案 | 逐格ΔE | p90 | 断线率 | 翻转率 | 用色 | 分 |',
      '|---|---|---|---|---|---|---|',
      ...rows.map(r => `| ${r.label} | ${r.cellDe} | ${r.cellDeP90} | ${(r.lineBreak * 100).toFixed(1)}% | ${r.flip}% | ${r.colors} | ${r.score} |`),
      '',
      'agent 终审提示：机器分只保底，仍须按 ai-tutor-protocol §目检三轮 对照原图看 compare.png——',
      '机器测不出「形对不对/主体像不像」，那一步是大模型在环的价值所在。'
    ].join('\n') + '\n', 'utf-8')
  }
}

const qres = ditherMode === 'fs'
  ? quantizeWithDither(img, palette, { grid, sensitive: sensitiveOn, flat: flatLevel > 0, sample: sampleMode, regionLock: regionLockDe, lockMinArea, inkMin })
  : quantizeToGrid(img, palette, { grid, sensitive: sensitiveOn, sample: effSample, regionLock: effLock, lockMinArea, inkMin: effInk })
let gridArr = qres.grid
let paletteUsed = qres.paletteUsed
let stats = qres.stats
console.log(`▶ 网格: ${stats.w}x${stats.h}=${stats.w * stats.h} 格 | 量化用色 ${stats.colors}（${ditherMode}）| 出豆 ${stats.beads} | 空位 ${stats.empty}（${(stats.empty / (stats.w * stats.h) * 100).toFixed(1)}%）| 耗时 ${stats.elapsedMs}ms`)
if (stats.sampleMode === 'avg') console.log('▶ 取样: 格内均值（--sample avg 对照口径）')
if (stats.lockInfo) console.log(`▶ 区域锁定: ΔE≤${stats.lockInfo.de} 的 ${stats.lockInfo.regions} 个大区归一，改写 ${stats.lockInfo.merged} 格`)
if (ditherMode === 'fs' && flatLevel > 0) console.log(`▶ 平色优先: FS 平坦源区 ${stats.flatCells || 0} 格（这些格不扩散误差）`)

// ---------- 边缘描边（风格项，--outline 1 开） ----------
if (outlineOn) {
  const ol = applyOutline(gridArr, stats.w, stats.h, palette)
  gridArr = ol.grid
  console.log(`▶ 描边: 边缘格 ${ol.edgeCells}，加深重映射 ${ol.outlined} 格（×0.62）`)
}

// ---------- regionClean 平色（默认开；⚠️ 抖动模式跳过一切清理——FS 纹理有意保留） ----------
if (cleanLevel > 0 && ditherMode !== 'fs') {
  const t1 = Date.now()
  const before = stats.colors
  const rc = regionClean(gridArr, stats.w, stats.h, cleanLevel, palette)
  gridArr = rc.grid
  const recounted = recountColors(gridArr, stats.w, stats.h, palette)
  paletteUsed = recounted.paletteUsed
  stats = { ...stats, colors: recounted.stats.colors, beads: recounted.stats.beads, empty: recounted.stats.empty }
  console.log(`▶ 平色(clean=${cleanLevel}): ${before} → ${stats.colors} 色（归并 ${rc.merged} 格 / ${rc.rounds} 轮，${Date.now() - t1}ms）`)
}

// ---------- ΔE 色对归并（--maxcolors N：低用量近邻色并入大色，压色数省采购） ----------
if (maxColors > 0 && ditherMode !== 'fs') {
  let guard = 0
  while (stats.colors > maxColors && guard++ < 6) {
    const before = stats.colors
    const mc = mergeCloseColors(gridArr, stats.w, stats.h, palette, {
      deLimit: 8 + guard * 4, // 逐轮放宽 ΔE（8→12→16...）直到达标或放弃
      lowShare: 0.03 + (guard - 1) * 0.02
    })
    gridArr = mc.grid
    paletteUsed = mc.paletteUsed
    stats = { ...stats, colors: mc.stats.colors, beads: mc.stats.beads, empty: mc.stats.empty }
    console.log(`▶ 归并(→${maxColors}): ${before} → ${stats.colors} 色（ΔE≤${8 + guard * 4}，${mc.merged.length} 对：${mc.merged.slice(0, 3).map(m => `${m.from}→${m.to}(ΔE${m.dE})`).join(' ')}${mc.merged.length > 3 ? '…' : ''}）`)
    if (stats.colors >= before) break // 放宽也不动了 = 放弃
  }
  if (stats.colors > maxColors) {
    console.log(`  ⚠ 无法归并到 ${maxColors} 色（进一步放宽 ΔE 会明显变色）——当前 ${stats.colors} 色，如实交付`)
  }
}

// ---------- 平色优先（--flat 1|2：平坦区多数派；FS 抖动模式同样生效） ----------
if (flatLevel > 0) {
  const t1 = Date.now()
  const before = stats.colors
  const fp = applyFlatPriority(gridArr, stats.w, stats.h, palette, flatLevel)
  gridArr = fp.grid
  const recounted = recountColors(gridArr, stats.w, stats.h, palette)
  paletteUsed = recounted.paletteUsed
  stats = { ...stats, colors: recounted.stats.colors, beads: recounted.stats.beads, empty: recounted.stats.empty }
  stats.decisions.push(`flat level=${flatLevel} flatCells=${fp.flatCells} changed=${fp.changed}`)
  console.log(`▶ 平色优先(flat=${flatLevel}): 平坦格 ${fp.flatCells}，归并 ${fp.changed} 格 / ${before} → ${stats.colors} 色（${Date.now() - t1}ms）`)
}

// ---------- 碎色诊断（2026-10-21 二次修正：判据反转） ----------
// ⚠️ 血泪教训（用户两次反馈）：
//   ① 「更大格子观感好」≠「网格数要少」——抽象度由【网格数】决定（APP 实测：24 档细节保留率
//      2.3% → 256 档 17.0%），32 格的油画/照片就是「太抽象」。
//   ② 色数多 ≠ 难看。梵高自画像 64 格 58 色是笔触的真实色彩；压到 24 格 31 色反而丢形。
//   ③ 真正难看的是【孤点杂色】——每色只有 1~2 颗、散落在别色包围中（拼起来找不到、脏）。
// 现判据 = 孤点率（低用量豆数 / 总豆数）：只抓「碎点」，不评判色数多少。
const top5 = paletteUsed.slice(0, 5).reduce((s, c) => s + c.share, 0)
const lowUse = paletteUsed.filter(c => c.count <= 2) // ≤2 颗 = 拼制时几乎找不到的孤点
const lowUseBeads = lowUse.reduce((s, c) => s + c.count, 0)
const speckleRate = stats.beads > 0 ? lowUseBeads / stats.beads : 0
const noiseLevel = speckleRate > 0.10 ? 'very-noisy' : speckleRate > 0.05 ? 'noisy' : 'clean'
console.log(`▶ 孤点诊断: colors=${stats.colors} top5Share=${top5.toFixed(1)}% 孤点色=${lowUse.length}/${stats.colors}（共 ${lowUseBeads} 颗，孤点率 ${(speckleRate * 100).toFixed(2)}%）⇒ ${noiseLevel}`)
if (noiseLevel !== 'clean') {
  console.log(`  ⚠ 孤点率 ${(speckleRate * 100).toFixed(1)}% 偏高（拼制难找、观感脏）：优先开去噪（强力清理，待迁移）；降档只是次选——降档会丢细节、更抽象`)
} else {
  console.log(`  ✓ 孤点率 ${(speckleRate * 100).toFixed(2)}%，色数 ${stats.colors} 是图像本身色彩结构，不需要降档（降档 = 丢细节、变抽象）`)
}

// ---------- 平坦翻转率诊断（REPORT.md 核心指标，2026-10-22）----------
// 「像不像」的量化代理：源相邻格 ΔE≤3（肉眼同色）却输出不同色号的邻对占比。
// 孤点率测不出成片翻转，这个测得出；worst 对（outΔE 大）= Voronoi 分界翻转定罪证据。
// 大模型回调判读：fs 模式下翻转率应≈nearest 基线（护栏生效）；nearest 下仍高 = 候选色过密的
// 症状 2 机制（REPORT §三.B），处置是 --maxcolors/--adaptive，不是降格。
{
  const srcLabGrid = extractSrcLabGrid(img, stats.w, stats.h)
  const ff = flatFlipRate(srcLabGrid, gridArr, stats.w, stats.h, palette)
  stats.flatFlipRate = ff.rate
  console.log(`▶ 平坦翻转率: ${ff.rate}%（${ff.flips}/${ff.pairs} 平坦邻对被翻转）`)
  if (ff.worst.length && ff.worst[0].outDe > 20) {
    console.log(`  ⚠ 最差翻转对 ${ff.worst[0].a}↔${ff.worst[0].b}（源 ΔE ${ff.worst[0].srcDe} → 输出 ΔE ${ff.worst[0].outDe}）——候选色过密的分界翻转，可试 --maxcolors 压候选`)
  } else if (ff.rate > 30) {
    console.log(`  ⚠ 翻转率 ${ff.rate}% 偏高：源图平色区本身有色阶跨度（翻拍版常见），或候选过密`)
  } else {
    console.log(`  ✓ 翻转率 ${ff.rate}% 在正常范围（fs 护栏/nearest 基线同量级）`)
  }
}

// ---------- 落盘 ----------
fs.mkdirSync(outDir, { recursive: true })

// ① 网格图 PNG（渲染期放大：每格 scale×scale 纯色块——看图器放大不糊）
//    自适应：总边长目标 ~1536px，scale 上限 16、下限 1（8192 格时 scale=1 就是 8192px 总览）
const scale = Math.max(1, Math.min(16, Math.floor(1536 / Math.max(stats.w, stats.h))))
const png = renderGridPng(gridArr, stats.w, stats.h, palette, scale)
fs.writeFileSync(path.join(outDir, 'blueprint.png'), png)
console.log(`✔ ${path.join(outDir, 'blueprint.png')}（${(png.length / 1024).toFixed(1)}KB，${stats.w * scale}x${stats.h * scale}px = 每格 ${scale}px，打开即清晰网格）`)

// ①b 施工图纸（带网格线 + 行列编号 + 逐格色号 + 底部图例——照着拼的那张图）
//     cellPx 自适应：≤64 格给 36px（舒适阅读），大网格递减到 24（下限，色号仍可读）
const legendData = paletteUsed.map(c => ({ code: c.code, hex: c.hex, rgb: c.rgb, count: c.count }))
const cellPx = stats.w <= 64 && stats.h <= 64 ? 36 : Math.max(24, Math.min(36, Math.floor(1600 / Math.max(stats.w, stats.h))))
// 超大网格档：整张施工图纸画布 = (gw×cellPx)×(gh×cellPx)，512 格就已 151MP RGBA（~600MB）
// ⇒ 超过 64MP 画布不整张出图，改由 --split 分块（SKILL.md「超大网格档出图策略」）
const sheetPx = (stats.w * cellPx) * (stats.h * cellPx)
if (cellPx >= 22 && !splitSize && sheetPx <= 64e6) {
  const sheet = renderBlueprintSheet(gridArr, stats.w, stats.h, palette, cellPx, { legend: legendData })
  fs.writeFileSync(path.join(outDir, 'sheet.png'), sheet)
  console.log(`✔ ${path.join(outDir, 'sheet.png')}（${(sheet.length / 1024).toFixed(1)}KB，${cellPx}px/格 施工图纸：网格线+行列编号+逐格色号+图例）`)
} else if (!splitSize && sheetPx > 64e6) {
  console.log(`⚠ 网格 ${stats.w}×${stats.h} 的整张施工图纸需 ${(sheetPx / 1e6).toFixed(0)}MP 画布（>64MP 上限），已跳过；请加 --split 52 输出分块图纸`)
}

// ①c 分区输出（--split N：分块索引 + 按需块图纸；全局行列号跨块对得上）
let teachBlocks = null
if (splitSize >= 16) {
  const idx = buildBlockIndex(gridArr, stats.w, stats.h, palette, splitSize, 3)
  teachBlocks = idx.blocks
  const total = idx.total
  const padN = String(total).length
  const fnameOf = b => `sheet-block-${String(b).padStart(padN, '0')}.png`
  const renderSet = new Set()
  if (blockSel > 0) {
    if (blockSel > total) { console.error(`✗ --block ${blockSel} 超出范围（共 ${total} 块）`); process.exit(1) }
    renderSet.add(blockSel)
  } else if (total <= 256) {
    for (let i = 1; i <= total; i++) renderSet.add(i)
  } else {
    console.log(`▶ 分区: ${idx.blocksX}x${idx.blocksY} = ${total} 块；块数 >256，默认只出索引，用 --block K 按需出图`)
  }
  fs.writeFileSync(path.join(outDir, 'blocks-index.json'), JSON.stringify({
    source: path.basename(input),
    grid: { w: stats.w, h: stats.h },
    splitSize, blocksX: idx.blocksX, blocksY: idx.blocksY, total,
    blocks: idx.blocks
  }, null, 2), 'utf-8')
  const blockCellPx = Math.max(28, Math.min(36, Math.floor(1400 / splitSize)))
  const indexLines = []
  indexLines.push(`# 分区图纸索引 — ${path.basename(input)}（${stats.w}×${stats.h} 格，${total} 块）`)
  indexLines.push('')
  indexLines.push(`> 按需出块：\`node scripts/run.mjs ${path.basename(input)} --grid ${grid} --split ${splitSize} --block K\``)
  indexLines.push('')
  indexLines.push('| 块号 | 文件 | 行范围 | 列范围 | 豆数 | 主色 top3 |')
  indexLines.push('|---|---|---|---|---|---|')
  for (const b of idx.blocks) {
    const bn = b.block
    const x0 = b.col0 - 1; const y0 = b.row0 - 1
    const bw = b.cols; const bh = b.rows
    let fname = '-'
    if (renderSet.has(bn)) {
      const block = new Int16Array(bw * bh)
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) block[y * bw + x] = gridArr[(y0 + y) * stats.w + (x0 + x)]
      }
      const inBlock = new Map()
      for (let i = 0; i < block.length; i++) {
        const v = block[i]
        if (v < 0) continue
        inBlock.set(v, (inBlock.get(v) || 0) + 1)
      }
      const blockLegend = [...inBlock.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([i, count]) => {
          const c = palette.colors[i]
          return { code: c.code, hex: c.hex, rgb: c.rgb, count }
        })
      const title = `BLOCK ${bn}/${total} R${b.row0}-${b.row1} C${b.col0}-${b.col1}`
      const sheetB = renderBlueprintSheet(block, bw, bh, palette, blockCellPx, {
        ox: x0, oy: y0, legend: blockLegend, title
      })
      fname = fnameOf(bn)
      fs.writeFileSync(path.join(outDir, fname), sheetB)
      if (blockSel > 0) {
        // 按需块的逐格展开（矩阵 + ASCII）
        fs.writeFileSync(path.join(outDir, `block-${bn}-ascii.txt`), renderAsciiMatrix(block, bw, bh, palette), 'utf-8')
        const bm = {
          w: bw, h: bh, ox: x0, oy: y0, palette: palette.code,
          legend: blockLegend.map(c => ({ code: c.code, hex: c.hex, count: c.count })),
          cells: Array.from(block).map(i => i < 0 ? -1 : palette.colors[i].code)
        }
        fs.writeFileSync(path.join(outDir, `block-${bn}.json`), JSON.stringify(bm), 'utf-8')
      }
    }
    indexLines.push(`| ${bn} | ${fname} | ${b.row0}~${b.row1} | ${b.col0}~${b.col1} | ${b.beads} | ${b.top.map(t => `${t.code}×${t.count}`).join(' / ') || '-'} |`)
  }
  fs.writeFileSync(path.join(outDir, 'sheet-blocks.md'), indexLines.join('\n') + '\n', 'utf-8')
  console.log(`✔ blocks-index.json（${total} 块，含每块主色 top3）+ sheet-blocks.md${renderSet.size ? ` + ${renderSet.size} 张分块图纸` : '（按需出块）'}`)
}

// ①d 前后对比图（原图 vs 拼豆效果并排——「拼出来像不像」一眼可判）
const cmp = renderCompare(img, gridArr, stats.w, stats.h, palette, 640)
fs.writeFileSync(path.join(outDir, 'compare.png'), cmp)
console.log(`✔ ${path.join(outDir, 'compare.png')}（${(cmp.length / 1024).toFixed(1)}KB，原图 vs 拼豆效果并排对比）`)

// ①e 视觉终审图（review.png：给多模态大模型看的图——可疑格红框标注）
// WHY（2026-10-25 用户裁定）：多模态在环不能只写在协议里——agent 有视觉就必须用：
// 机器把可疑格定位并框出来（注意力引导），agent 看图终审「框里是不是真缺陷」后才允许交付。
if (stats.w * stats.h <= 2 * 1000 * 1000) {
  const defects = locateDefects(img, gridArr, stats.w, stats.h, palette, { skipFlip: ditherMode === 'fs' })
  const rv = renderReview(img, gridArr, stats.w, stats.h, palette, defects, 640)
  fs.writeFileSync(path.join(outDir, 'review.png'), rv)
  const kinds = defects.reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m }, {})
  console.log(`✔ ${path.join(outDir, 'review.png')}（${(rv.length / 1024).toFixed(1)}KB，红框=${defects.length} 处机器可疑点：断线 ${kinds.break || 0} / 劈叉 ${kinds.flip || 0} / 偏色 ${kinds.de || 0}）`)
  // 视觉终审留痕（可审计）：逐框判定表 review.md——agent 必须逐框填「判定/处置」，
  // 填完的 review.md 就是「看过图」的证据；空表交付 = 未终审（协议禁止）。
  const KIND_CN = { break: '断线', flip: '劈叉', de: '偏色' }
  fs.writeFileSync(path.join(outDir, 'review.md'), [
    `# 视觉终审判定表 — ${path.basename(input)}（${stats.w}×${stats.h} 格）`,
    '',
    `> 用法：打开 review.png，逐框看图，在「判定」「处置」两列填字。填完的这张表 = 终审证据。`,
    `> 判定口径：画布裂纹/扫描噪点/有意的描边纹理 = 误报；线断了/色块劈叉/明显偏色 = 真缺陷。`,
    '',
    '| # | 格(列,行) | 类型 | 机器判据 | 判定（真缺陷/误报） | 处置（改什么参数 / 无需） |',
    '|---|---|---|---|---|---|',
    ...defects.map((d, i) => `| ${i + 1} | (${d.gx + 1},${d.gy + 1}) | ${KIND_CN[d.kind]} | ${d.kind === 'break' ? '期望出线却输出浅色' : d.kind === 'flip' ? '源同色邻格输出两个远色号' : '单格 ΔE≥40'} | | |`),
    '',
    `终审结论（三选一，勾掉其余）：`,
    '',
    `- [ ] 全部误报，直接交付`,
    `- [ ] 有真缺陷，已按协议调参重跑（第 ___ 轮 / 上限 3 轮）：`,
    `- [ ] 3 轮上限仍不达标，如实声明残缺后交付，残缺点：`,
    ''
  ].join("\n") + "\n", 'utf-8')
  console.log(`⚠ 视觉终审（硬门槛）：交付前必须【看】review.png 与 compare.png，并逐框填写 ${path.join(outDir, 'review.md')} 判定表——填完的判定表 = 「看过图」的可审计证据，空表交付 = 未终审。有真缺陷 → 调参重跑（上限 3 轮）；只看指标不看图 = 本末倒置。`)
} else {
  console.log('⚠ 网格 > 200 万格，review.png 跳过（过大）；请用 --split 分块后逐块终审')
}

// ② 逐格色号矩阵 JSON
const matrix = {
  w: stats.w, h: stats.h, palette: palette.code,
  legend: paletteUsed.map(c => ({ code: c.code, fullCode: c.fullCode, name: c.name, hex: c.hex, count: c.count })),
  cells: Array.from(gridArr).map(i => i < 0 ? -1 : palette.colors[i].code)
}
fs.writeFileSync(path.join(outDir, 'blueprint.json'), JSON.stringify(matrix))
console.log(`✔ ${path.join(outDir, 'blueprint.json')}（-1 = 空位）`)

// ②b 全局 ASCII 矩阵（auto：短边 ≤512 才出；显式 1 强出但 >200 万格仍拒）
let asciiWritten = false
const asciiCells = stats.w * stats.h
const wantAscii = asciiMode === '1' || (asciiMode === 'auto' && Math.max(stats.w, stats.h) <= 512)
if (wantAscii && asciiCells <= 2_000_000) {
  const asciiTxt = renderAsciiMatrix(gridArr, stats.w, stats.h, palette)
  fs.writeFileSync(path.join(outDir, 'blueprint-ascii.txt'), asciiTxt, 'utf-8')
  asciiWritten = true
  console.log(`✔ ${path.join(outDir, 'blueprint-ascii.txt')}（${stats.w}×${stats.h} 文本矩阵，可直接 grep/逐行核数）`)
} else if (wantAscii) {
  console.log(`⚠ ASCII 矩阵 ${asciiCells} 格超过 200 万上限，跳过（用 --split 分块后的 block-K-ascii.txt 代替）`)
}

// ③ 图纸文档（色号表 + 统计 + 采购 + 处理报告）
const packs = purchaseList(paletteUsed, 200)
const md = []
md.push(`# 拼豆图纸 — ${path.basename(input)}（${grid} 格）`)
md.push('')
md.push(`> 生成: ${new Date().toISOString()} | 色盘: ${palette.name} | 网格: ${stats.w}×${stats.h}`)
if (cropSpec) md.push(`> 裁剪: ${cropSpec}`)
if (exifOrientation > 1) md.push(`> EXIF 方向 ${exifOrientation}：已转正`)
md.push('')
md.push('## 处理报告（参数回显 + 决策数据）')
md.push('')
for (const d of stats.decisions) md.push(`- ${d}`)
md.push(`- 耗时 ${stats.elapsedMs}ms`)
md.push('')
md.push('## 用色统计')
md.push('')
md.push(`总色数 **${stats.colors}** | 总颗数 **${stats.beads}** | 空位 **${stats.empty}**（${(stats.empty / (stats.w * stats.h) * 100).toFixed(1)}%）`)
if (asciiWritten) md.push(`\n文本矩阵：\`blueprint-ascii.txt\`（逐格色号，空格=空位，可直接逐行核数）`)
md.push('')
md.push('## 色号表')
md.push('')
const hasProductInfo = paletteUsed.some(c => (c.fullCode && c.fullCode !== c.code) || c.name)
if (hasProductInfo) {
  md.push('| # | 色号 | 产品号 | 名称 | HEX | 颗数 | 占比 | 采购(200颗/包) |')
  md.push('|---|------|--------|------|-----|------|------|------|')
  paletteUsed.forEach((c, i) => {
    const p = packs[i]
    md.push(`| ${i + 1} | ${c.code} | ${c.fullCode || c.code} | ${c.name || ''} | #${c.hex} | ${c.count} | ${c.share}% | ${p.packs} 包${p.remainder ? `（余 ${p.remainder}）` : ''} |`)
  })
  if (palette.code === 'perler118') md.push('')
  if (palette.code === 'perler118') md.push('> 格子内是简写色号 P1..P118；采购请按「产品号」列。')
} else {
  md.push('| # | 色号 | HEX | 颗数 | 占比 | 采购(200颗/包) |')
  md.push('|---|------|-----|------|------|------|')
  paletteUsed.forEach((c, i) => {
    const p = packs[i]
    md.push(`| ${i + 1} | ${c.code} | #${c.hex} | ${c.count} | ${c.share}% | ${p.packs} 包${p.remainder ? `（余 ${p.remainder}）` : ''} |`)
  })
}
md.push('')
md.push(`## 采购清单`)
md.push('')
const totalPacks = packs.reduce((s, p) => s + p.packs, 0)
md.push(`共 ${stats.colors} 色 / ${stats.beads} 颗 ⇒ **${totalPacks} 包**（按 200 颗/包规格）`)
md.push('')
md.push('> 说明：色值为工程预置近似值，采购前建议用实体色卡校准；本图纸不含原料采购链接。')

// 工作流 B⑨：库存覆盖 + 缺色就近替换建议
if (inventory) {
  const invSet = new Set(inventory.codes)
  const invColors = palette.colors.filter(c => invSet.has(c.code))
  const missing = paletteUsed.filter(c => !invSet.has(c.code))
  const coveredBeads = paletteUsed.filter(c => invSet.has(c.code)).reduce((s, c) => s + c.count, 0)
  const coverage = stats.beads > 0 ? (coveredBeads / stats.beads * 100).toFixed(1) : '0.0'
  md.push('')
  md.push('## 库存覆盖与缺色（工作流 B）')
  md.push('')
  md.push(`库存 **${inventory.codes.length}** 色覆盖本次用色 ${paletteUsed.length - missing.length}/${paletteUsed.length} 色（${coverage}% 颗数），缺 **${missing.length}** 色共 ${missing.reduce((s, c) => s + c.count, 0)} 颗。`)
  if (missing.length > 0) {
    md.push('')
    md.push('| 缺色 | HEX | 需补颗数 | 最接近库存色 | ΔE |')
    md.push('|---|---|---|---|---|')
    for (const m of missing) {
      const mlab = rgbToLab(m.rgb)
      let best = null; let bestD = Infinity
      for (const c of invColors) {
        const d = labDist2(mlab, c.lab)
        if (d < bestD) { bestD = d; best = c }
      }
      md.push(`| ${m.code} | #${m.hex} | ${m.count} | ${best ? best.code : '-'} | ${best ? Math.sqrt(bestD).toFixed(1) : '-'} |`)
    }
    md.push('')
    md.push('> 建议：先用 `--limit-palette` 跑一版「只用库存色」的图纸对比；ΔE>8 的替换会明显变色，需人工确认。')
  }
  console.log(`▶ 库存覆盖: ${coveredBeads}/${stats.beads} 颗（${coverage}%），缺 ${missing.length} 色共 ${missing.reduce((s, c) => s + c.count, 0)} 颗`)
}
fs.writeFileSync(path.join(outDir, 'blueprint.md'), md.join('\n'), 'utf-8')
console.log(`✔ ${path.join(outDir, 'blueprint.md')}（色号表 ${stats.colors} 行 + 统计 + 采购清单）`)

// ④ AI 辅导计划（--teach：难度评定 + 工时场次 + 专属易错点 + 辅导问题 + 反馈思路 → coaching.md）
if (teachOn) {
  const plan = buildTeachingPlan({
    fileName: path.basename(input),
    paletteName: palette.name,
    w: stats.w, h: stats.h,
    colors: stats.colors, beads: stats.beads, empty: stats.empty,
    speckleRate, top5Share: top5,
    dither: ditherMode, outline: outlineOn, sensitive: sensitiveOn,
    flat: flatLevel > 0, splitSize,
    blocks: teachBlocks,
    level: teachLevel, sessionMinutes
  })
  fs.writeFileSync(path.join(outDir, 'coaching.md'), renderCoachingMarkdown(plan), 'utf-8')
  const lv = { beginner: '入门', intermediate: '进阶', advanced: '挑战' }[plan.level] || plan.level
  console.log(`✔ ${path.join(outDir, 'coaching.md')}（辅导计划：档位 ${lv}，约 ${plan.pace.hours}h / ${plan.pace.sessions} 场，含易错点与反馈思路）`)
}
console.log(`\n完成。图纸文件已落盘（教学指导由 agent 对话生成；超大网格档请用 --split 52 出分块图纸）。`)
