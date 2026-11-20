#!/usr/bin/env node
/**
 * run-evals.js — pixel-bead-blueprint 可跑评测（Tier 3 口径的最小实现，ESM）
 *
 * 用法：node evals/run-evals.js [--only EVAL-A-001] [--json]
 * 行为：读 evals/evals.json，对 kind=cli 的用例执行 CLI 并做机器判定；
 *       kind=manual 的用例只打印人工检查清单（不判 PASS/FAIL）。
 * 输出：终端表格 + BENCHMARK.md（覆盖写），退出码 0 = 全部 cli 用例通过。
 *
 * 不依赖网络、不修改包内文件（临时输出落在系统 tmp 目录）。
 * 注：包内 package.json 为 "type": "module"，因此本文件使用 ESM（import）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'evals.json'), 'utf-8'))
const argv = process.argv.slice(2)
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const asJson = argv.includes('--json')

const TMPBASE = fs.mkdtempSync(path.join(os.tmpdir(), 'pbb-evals-'))
const results = []
let failed = 0

function resolveArgs (args, ctx) {
  return args.map(a => a
    .replace('{{mondrian}}', path.join(ROOT, SPEC.fixtures.mondrian))
    .replace('{{progressive}}', path.join(ROOT, SPEC.fixtures.progressive))
    .replace(/\{\{tmp\}\}/g, ctx))
}

function runCli (args, ctx) {
  const res = spawnSync(process.execPath, resolveArgs(args, ctx), {
    cwd: ROOT, encoding: 'utf-8', timeout: 300000,
    env: { ...process.env, NO_COLOR: '1' }
  })
  return { code: res.status, out: `${res.stdout || ''}${res.stderr || ''}` }
}

/** 断言：返回问题列表（空数组 = 通过） */
function check (c, tmp, res) {
  const problems = []
  const e = c.expect || {}

  if (e.exitCode !== undefined && res.code !== e.exitCode) {
    problems.push(`exitCode=${res.code}（期望 ${e.exitCode}）`)
  }
  for (const f of e.files || []) {
    if (!fs.existsSync(path.join(tmp, f))) problems.push(`缺少文件 ${f}`)
  }

  // blueprint.md 内容断言
  if ((e.mdInclude || []).length) {
    const mdPath = path.join(tmp, 'blueprint.md')
    if (!fs.existsSync(mdPath)) problems.push('缺少 blueprint.md（无法检查内容）')
    else {
      const md = fs.readFileSync(mdPath, 'utf-8')
      for (const s of e.mdInclude) if (!md.includes(s)) problems.push(`blueprint.md 缺「${s}」`)
    }
  }
  // 指定文件内容断言
  for (const [f, needles] of Object.entries(e.mdIncludeIn || {})) {
    const p = path.join(tmp, f)
    if (!fs.existsSync(p)) { problems.push(`缺少 ${f}`); continue }
    const t = fs.readFileSync(p, 'utf-8')
    for (const s of needles) if (!t.includes(s)) problems.push(`${f} 缺「${s}」`)
  }

  // JSON 字段断言（默认作用于 blueprint.json）
  const checkFields = (file, fields) => {
    const p = path.join(tmp, file)
    if (!fs.existsSync(p)) { problems.push(`缺少 ${file}`); return }
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
    for (const [k, v] of Object.entries(fields)) {
      if (j[k] !== v) problems.push(`${file}.${k}=${JSON.stringify(j[k])}（期望 ${JSON.stringify(v)}）`)
    }
  }
  if (e.jsonFields && Object.keys(e.jsonFields).length) checkFields('blueprint.json', e.jsonFields)
  for (const [f, fields] of Object.entries(e.jsonFieldsIn || {})) checkFields(f, fields)

  for (const s of e.stdoutInclude || []) {
    if (!res.out.includes(s)) problems.push(`stdout 缺「${s}」`)
  }

  // 网格断言：短边 = 指定格数（长边按源图比例可为 short+1）
  if (e.assertGrid) {
    const file = e.assertGrid.file || 'blueprint.json'
    const fp = path.join(tmp, file)
    if (!fs.existsSync(fp)) problems.push(`缺少 ${file}`)
    else {
      const j = JSON.parse(fs.readFileSync(fp, 'utf-8'))
      const shortSide = Math.min(j.w, j.h)
      if (shortSide !== e.assertGrid.shortSide) {
        problems.push(`${file} 短边=${shortSide}（期望 ${e.assertGrid.shortSide}），实际 ${j.w}×${j.h}`)
      }
      if (!(j.w > 0 && j.h > 0 && Array.isArray(j.cells) && j.cells.length === j.w * j.h)) {
        problems.push(`${file} cells 数与 w×h 不一致（${j.cells && j.cells.length} vs ${j.w * j.h}）`)
      }
    }
  }

  // 分块索引断言：块数 / 编号连续 / 每块 beads+top / 行列覆盖
  if (e.assertBlocks) {
    const p = path.join(tmp, e.assertBlocks.blocksIndex)
    if (!fs.existsSync(p)) problems.push(`缺少 ${e.assertBlocks.blocksIndex}`)
    else {
      const bi = JSON.parse(fs.readFileSync(p, 'utf-8'))
      const blocks = bi.blocks || []
      const expectCount = (bi.blocksX || 0) * (bi.blocksY || 0)
      if (!blocks.length) problems.push('blocks 为空')
      if (expectCount && blocks.length !== expectCount) {
        problems.push(`块数 ${blocks.length} ≠ blocksX×blocksY=${expectCount}`)
      }
      const ids = new Set(blocks.map(b => b.block))
      for (let i = 1; i <= blocks.length; i++) if (!ids.has(i)) problems.push(`缺块号 ${i}`)
      const bad = blocks.find(b => !(b.beads > 0) || !(b.top && b.top.length))
      if (bad) problems.push(`块 ${bad.block} 缺 beads/top`)
      if (bi.grid) {
        const gw = typeof bi.grid === 'object' ? bi.grid.w : bi.grid
        const gh = typeof bi.grid === 'object' ? bi.grid.h : bi.grid
        const maxR = Math.max(...blocks.map(b => b.row1))
        const maxC = Math.max(...blocks.map(b => b.col1))
        if (gh && maxR !== gh) problems.push(`行覆盖到 ${maxR}，期望 ${gh}`)
        if (gw && maxC !== gw) problems.push(`列覆盖到 ${maxC}，期望 ${gw}`)
      }
    }
  }
  return problems
}

function fillReview (file) {
  let s = fs.readFileSync(file, 'utf-8')
  s = s.replace(/^(\| \d+ \| \([^)]+\) \| [^|]+ \| [^|]+ \|)\s*\|\s*\|/gm, '$1 误报 | 无需：评测自动填表 |')
  s = s.replace('- [ ] 全部误报，直接交付', '- [x] 全部误报，直接交付')
  fs.writeFileSync(file, s, 'utf-8')
}

const t0 = Date.now()
const cache = new Map()

for (const c of SPEC.cases) {
  if (only && c.id !== only) continue
  if (c.kind !== 'cli') {
    results.push({ id: c.id, kind: 'manual', status: 'MANUAL', detail: c.intent })
    console.log(`\n○ ${c.id}  [manual] ${c.intent}`)
    for (const s of c.checklist || c.steps || []) console.log(`   · ${s}`)
    if (c.why) console.log(`   （${c.why}）`)
    continue
  }
  const tmp = cache.get(c.reuse) || fs.mkdtempSync(path.join(TMPBASE, `${c.id}-`))
  cache.set(c.id, tmp)
  let problems = []
  if (c.reuse) {
    const src = cache.get(c.reuse)
    if (!src || !fs.existsSync(src)) problems.push(`reuse 目标 ${c.reuse} 不存在（用 --only 单独跑时无法复用）`)
    else problems = check(c, src, { code: 0, out: '' })
  } else {
    const res = runCli(c.command, tmp)
    problems = check(c, tmp, res)
    if (c.then) {
      try {
        fillReview(path.join(tmp, path.basename(c.then.fillReview)))
      } catch (e) { problems.push(`填表失败：${e.message}`) }
      const r2 = runCli(c.then.command, tmp)
      problems.push(...check({ expect: c.then.expect }, tmp, r2).map(p => `[then] ${p}`))
    }
  }
  const status = problems.length ? 'FAIL' : 'PASS'
  if (problems.length) failed++
  results.push({ id: c.id, kind: 'cli', status, problems, tmp })
  console.log(`${status === 'PASS' ? '●' : '✗'} ${c.id}  [${status}] ${c.intent}`)
  for (const p of problems) console.log(`     - ${p}`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(1)
const cli = results.filter(r => r.kind === 'cli')
const pass = cli.filter(r => r.status === 'PASS').length
console.log(`\n=== EVALS: ${pass}/${cli.length} PASS · ${results.length - cli.length} MANUAL · ${secs}s ===`)
console.log(`临时输出：${TMPBASE}`)
if (asJson) console.log(JSON.stringify({ pass, total: cli.length, results, secs }, null, 2))

const md = []
md.push('# BENCHMARK — pixel-bead-blueprint')
md.push('')
md.push(`> 生成：\`node evals/run-evals.js\` ｜ 时间：${new Date().toISOString()} ｜ 版本：v${SPEC.version}`)
md.push(`> 结果：**${pass}/${cli.length} cli 用例 PASS**，${results.length - cli.length} 项人工验收（manual），耗时 ${secs}s`)
md.push('')
md.push('| 用例 | 类型 | 结果 | 覆盖 |')
md.push('|---|---|---|---|')
for (const r of results) {
  const c = SPEC.cases.find(x => x.id === r.id)
  md.push(`| ${r.id} | ${r.kind} | ${r.status} | ${c.intent} |`)
}
md.push('')
if (failed) {
  md.push('## 失败明细')
  md.push('')
  for (const r of cli.filter(x => x.status === 'FAIL')) {
    md.push(`### ${r.id}`)
    for (const p of r.problems) md.push(`- ${p}`)
    md.push('')
  }
}
md.push('## 说明')
md.push('')
md.push('- 只判定 **CLI 可机器判定的部分**：退出码、交付物清单、文本/JSON 字段、门禁双向、分块索引完整性与行列覆盖。')
md.push('- `kind=manual` 属大模型在环行为（先问学员、参数给理由），需评审按 `test-cases/cases.md` 人工打勾。')
md.push('- 评测不改包内文件：产物写在系统临时目录，跑完即弃。')
fs.writeFileSync(path.join(HERE, 'BENCHMARK.md'), md.join('\n') + '\n', 'utf-8')
console.log('BENCHMARK.md 已更新')

process.exit(failed ? 1 : 0)