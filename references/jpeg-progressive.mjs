/**
 * jpeg-progressive.mjs — progressive JPEG（SOF2）自动转码兜底
 *
 * 为什么需要：网图/微信转发图大量是 progressive，本 skill 的纯 JS 解码器只吃 baseline。
 * 这里调用系统自带转换器转 PNG，再走 decodePng；不引入 npm 依赖。
 *
 * 转换器优先级：Windows PowerShell(System.Drawing) → macOS sips → ImageMagick(magick/convert) → Python Pillow
 * ⚠️ 转换器只转像素格式，不应用 EXIF 方向；方向由 jpeg.mjs 的 readJpegOrientation + applyOrientation 负责。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const TIMEOUT = 60000

function tryRun (cmd, args, opts = {}) {
  try {
    execFileSync(cmd, args, { stdio: 'pipe', timeout: TIMEOUT, ...opts })
    return true
  } catch {
    return false
  }
}

function psQuote (s) { return `'${String(s).replace(/'/g, "''")}'` }

/** 当前平台可用的转换器（用于 UI 提示 / 测试跳过）；不实际转换 */
export function availableProgressiveConverter () {
  if (process.platform === 'win32') return { tool: 'PowerShell/System.Drawing', cmd: 'powershell' }
  if (process.platform === 'darwin' && tryRun('sips', ['--version'])) return { tool: 'sips', cmd: 'sips' }
  if (tryRun('magick', ['-version'])) return { tool: 'ImageMagick', cmd: 'magick' }
  if (process.platform !== 'win32' && tryRun('convert', ['-version'])) return { tool: 'ImageMagick', cmd: 'convert' }
  for (const py of ['python', 'python3']) {
    if (tryRun(py, ['-c', 'import PIL'])) return { tool: 'Pillow', cmd: py }
  }
  return null
}

/**
 * 把 progressive JPEG 转成 PNG。返回 { png: Buffer, tool }。
 * 失败时抛出可读错误（包含已尝试的转换器）。
 */
export function convertProgressiveToPng (file) {
  const out = path.join(os.tmpdir(), `pbb-progressive-${process.pid}-${Date.now()}.png`)
  const tried = []
  try {
    if (process.platform === 'win32') {
      tried.push('PowerShell')
      const script = [
        'Add-Type -AssemblyName System.Drawing',
        `$src = [System.Drawing.Image]::FromFile(${psQuote(path.resolve(file))})`,
        `$src.Save(${psQuote(out)}, [System.Drawing.Imaging.ImageFormat]::Png)`,
        '$src.Dispose()'
      ].join('; ')
      if (tryRun('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]) && fs.existsSync(out)) {
        return { png: fs.readFileSync(out), tool: 'PowerShell/System.Drawing' }
      }
    } else if (process.platform === 'darwin') {
      tried.push('sips')
      if (tryRun('sips', ['-s', 'format', 'png', file, '--out', out]) && fs.existsSync(out)) {
        return { png: fs.readFileSync(out), tool: 'sips' }
      }
    } else {
      tried.push('magick')
      if (tryRun('magick', [file, out]) && fs.existsSync(out)) {
        return { png: fs.readFileSync(out), tool: 'ImageMagick' }
      }
      tried.push('convert')
      if (tryRun('convert', [file, out]) && fs.existsSync(out)) {
        return { png: fs.readFileSync(out), tool: 'ImageMagick' }
      }
    }
    // 通用兜底：Pillow
    for (const py of ['python', 'python3']) {
      tried.push(py + '+Pillow')
      const code = `from PIL import Image; Image.open(${JSON.stringify(path.resolve(file))}).save(${JSON.stringify(out)}, "PNG")`
      if (tryRun(py, ['-c', code]) && fs.existsSync(out)) {
        return { png: fs.readFileSync(out), tool: `${py}+Pillow` }
      }
    }
    throw new Error(
      `progressive JPEG 无法自动转码（已尝试：${tried.join(' / ')}）。` +
      '请先转成 baseline JPEG 或 PNG；或安装 ImageMagick / Pillow 后重试。'
    )
  } finally {
    try { fs.unlinkSync(out) } catch {}
  }
}
