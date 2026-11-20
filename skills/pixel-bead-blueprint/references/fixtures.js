/**
 * fixtures.js — 测试样张的 base64 内联载体解包器
 *
 * 背景：平台文件白名单不收二进制（.jpg/.png），样张改以 base64 内联在
 *   scripts/test/fixtures/fixtures.html
 * 行为：运行时按需提取到 scripts/test/fixtures/<name>；已存在则跳过（幂等）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const DIR = path.join(ROOT, 'scripts', 'test', 'fixtures')
const HTML = path.join(DIR, 'fixtures.html')

const RE = /data-fixture-name="([^"]+)"\s+data-fixture-mime="([^"]+)"\s+src="data:[^;]+;base64,([A-Za-z0-9+/=]+)"/g
const SAFE_NAME = /^[A-Za-z0-9._-]+$/

export function listFixtures() {
  if (!fs.existsSync(HTML)) return []
  const html = fs.readFileSync(HTML, 'utf8')
  const specs = []
  for (const m of html.matchAll(RE)) {
    if (!SAFE_NAME.test(m[1]) || m[1].startsWith('.')) continue
    specs.push({ name: m[1], mime: m[2], base64: m[3] })
  }
  return specs
}

export function extractFixtures({ force = false, verbose = false } = {}) {
  const result = { extracted: [], kept: [], errors: [], htmlPresent: fs.existsSync(HTML) }
  let specs = []
  try {
    specs = listFixtures()
  } catch (error) {
    result.errors.push(String(error?.message || error))
    return result
  }
  if (!specs.length) return result

  fs.mkdirSync(DIR, { recursive: true })
  for (const spec of specs) {
    const target = path.join(DIR, spec.name)
    if (!force && fs.existsSync(target)) {
      result.kept.push(spec.name)
      continue
    }
    try {
      fs.writeFileSync(target, Buffer.from(spec.base64, 'base64'))
      result.extracted.push(spec.name)
    } catch (error) {
      result.errors.push(`${spec.name}: ${error?.message || error}`)
    }
  }
  if (verbose && result.extracted.length) {
    console.log(`[fixtures] 已从 fixtures.html 提取：${result.extracted.join(', ')}`)
  }
  return result
}

export function ensureFixtures(options) {
  return extractFixtures(options)
}

// 直接运行本文件 = 手动提取入口（node references/fixtures.js [--force]）
const IS_MAIN = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (IS_MAIN) {
  const force = process.argv.slice(2).includes('--force')
  const result = extractFixtures({ force, verbose: true })
  console.log(JSON.stringify({
    htmlPresent: result.htmlPresent,
    extracted: result.extracted,
    kept: result.kept,
    errors: result.errors
  }, null, 2))
  if (result.errors.length) process.exitCode = 1
}