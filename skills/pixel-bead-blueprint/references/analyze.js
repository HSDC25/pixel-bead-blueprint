/**
 * analyze.js — 图像特征分析器（大模型推理的数据依据，2026-10-21）
 *
 * ⚠️ 定位（用户定稿）：skill 相对 APP 离线生成的核心优势 = **大模型在环**。
 *   本模块不做决策（不做「图类型→档位」查表——那是机械的，和离线没区别）；
 *   只做「机器测得准的量化特征」，把数据喂给 agent，agent 结合**视觉看图理解**
 *   （构图/主体/风格——机器测不出的）做推理决策，并给出理由。
 *
 * 输出特征（全部可解释、面向推理）：
 *   - colorEntropy    色彩熵（bit）：低=色少平涂，高=色彩丰富
 *   - uniqueQuant     量化桶色数（5bit/通道）：色彩复杂度
 *   - edgeDensity     边缘密度（0~1，Sobel 梯度超阈值占比）：细节密度
 *   - flatRatio       大平色区占比（8×8 块平坦）：卡通/扁平 vs 照片/绘画
 *   - lumaSpread      亮度动态范围（0~255）：明暗对比
 *   - satAvg          平均饱和度：鲜艳 vs 灰暗
 *   - dominantColors  主色 top5（占比）：色彩结构
 *   - guess           弱启发提示（仅供 agent 参考，不是决策！）
 */

import { rgbToLab, labDist2 } from './quantize.js'

export function analyzeImage (img) {
  const { w, h, data } = img
  const n = w * h
  // 1) 量化桶直方图（5bit/通道 → 32768 桶）
  const buckets = new Map()
  const coarse = new Map() // 4bit/通道（4096 桶）：照片主色占比才有信息量（5bit 桶 top1 常 <2%）
  let rS = 0; let gS = 0; let bS = 0; let lumaMin = 255; let lumaMax = 0; let satS = 0
  const step = Math.max(1, Math.floor(Math.sqrt(n / 250000))) // 大图采样
  let sampled = 0
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const p = (y * w + x) * 4
      if (data[p + 3] < 128) continue
      sampled++
      const r = data[p]; const g = data[p + 1]; const b = data[p + 2]
      rS += r; gS += g; bS += b
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      if (luma < lumaMin) lumaMin = luma
      if (luma > lumaMax) lumaMax = luma
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b)
      satS += mx === 0 ? 0 : (mx - mn) / mx
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      buckets.set(key, (buckets.get(key) || 0) + 1)
      const ckey = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      coarse.set(ckey, (coarse.get(ckey) || 0) + 1)
    }
  }
  // 2) 色彩熵
  let entropy = 0
  for (const c of buckets.values()) {
    const p = c / sampled
    entropy -= p * Math.log2(p)
  }
  // 3) 边缘密度（Sobel 近似：相邻像素梯度）+ 主体代理（中心 50% 框 vs 外圈，2026-10-22）
  //    主体是否突出机器测不出「语义」，但「细节集中在中心还是散在外圈」是可测的强代理：
  //    证件照/静物/宠物 → 中心边缘密度显著高于外圈；风景/满幅纹理 → 比值接近 1 或倒挂。
  let edgeCount = 0; let edgeTotal = 0
  let centerEdges = 0; let centerTotal = 0
  let edgeEdges = 0; let edgeTotalOuter = 0
  let cxSum = 0; let cySum = 0
  const estep = Math.max(1, Math.floor(Math.max(w, h) / 512))
  const ETH = 28
  const cx = w / 2; const cy = h / 2
  const hx = w * 0.25; const hy = h * 0.25
  for (let y = estep; y < h; y += estep) {
    for (let x = estep; x < w; x += estep) {
      const p = (y * w + x) * 4; const q = ((y - estep) * w + x) * 4; const r0 = (y * w + x - estep) * 4
      const gx = Math.abs(data[p] - data[r0]) + Math.abs(data[p + 1] - data[r0 + 1]) + Math.abs(data[p + 2] - data[r0 + 2])
      const gy = Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2])
      edgeTotal++
      const isEdge = Math.max(gx, gy) > ETH
      const inCenter = Math.abs(x - cx) <= hx && Math.abs(y - cy) <= hy
      if (inCenter) {
        centerTotal++
        if (isEdge) centerEdges++
      } else {
        edgeTotalOuter++
        if (isEdge) edgeEdges++
      }
      if (isEdge) {
        edgeCount++
        cxSum += x; cySum += y
      }
    }
  }
  const edgeDensity = edgeTotal > 0 ? edgeCount / edgeTotal : 0
  const centerEdgeDensity = centerTotal > 0 ? centerEdges / centerTotal : 0
  const edgeEdgeDensity = edgeTotalOuter > 0 ? edgeEdges / edgeTotalOuter : 0
  const subjectRatio = edgeEdgeDensity > 1e-6 ? centerEdgeDensity / edgeEdgeDensity : (centerEdgeDensity > 0 ? 9.99 : 1)
  const edgeCentroid = edgeCount > 0
    ? { x: +(cxSum / edgeCount / w).toFixed(3), y: +(cySum / edgeCount / h).toFixed(3) }
    : { x: 0.5, y: 0.5 }
  // 4) 大平色区占比（8×8 块平坦，采样）
  const bs = 8
  let blocks = 0; let flatBlocks = 0
  for (let by = 0; by + bs <= h; by += bs * 2) {
    for (let bx = 0; bx + bs <= w; bx += bs * 2) {
      blocks++
      let rMin = 255; let rMax = 0; let gMin = 255; let gMax = 0; let bMin = 255; let bMax = 0
      for (let y = by; y < by + bs; y += 2) {
        for (let x = bx; x < bx + bs; x += 2) {
          const p = (y * w + x) * 4
          if (data[p] < rMin) rMin = data[p]
          if (data[p] > rMax) rMax = data[p]
          if (data[p + 1] < gMin) gMin = data[p + 1]
          if (data[p + 1] > gMax) gMax = data[p + 1]
          if (data[p + 2] < bMin) bMin = data[p + 2]
          if (data[p + 2] > bMax) bMax = data[p + 2]
        }
      }
      if (rMax - rMin <= 16 && gMax - gMin <= 16 && bMax - bMin <= 16) flatBlocks++
    }
  }
  const flatRatio = blocks > 0 ? flatBlocks / blocks : 0
  // 5) 主色 top5（粗桶 4bit/通道——照片上 5bit 桶 top1 常 <2%，没有结构信息）
  const top = [...coarse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, c]) => {
      const rgb = [((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17]
      const hex = rgb.map(v => v.toString(16).padStart(2, '0').toUpperCase()).join('')
      return { hex, share: +(c / sampled * 100).toFixed(1) }
    })
  // 6) 弱启发提示（仅供参考，决策权在大模型）
  const hints = []
  if (flatRatio > 0.5 && entropy < 5) hints.push('flat-dominant: 大面积平色（卡通/扁平插画风）——细节损失风险低，网格数对观感不敏感')
  if (edgeDensity > 0.3) hints.push('detail-rich: 边缘密度高（笔触/纹理/浪花类）——网格低了必糊，宁高勿低；高色数用 --maxcolors 压采购而非降格')
  if (entropy > 7 && flatRatio < 0.2) hints.push('color-complex: 色彩熵高且无大平色区（照片/渐变）——考虑 fs 抖动出渐变纹理')
  if (lumaMax - lumaMin < 80) hints.push('low-contrast: 明暗动态范围窄——量化后层次易糊成一片')
  if (subjectRatio >= 1.35) hints.push(`subject-centered: 中心细节密度是外圈的 ${subjectRatio.toFixed(2)} 倍（主体大致居中）——按主体定网格，不用先裁`)
  if (subjectRatio <= 0.75) hints.push(`detail-spread: 中心细节密度仅外圈的 ${subjectRatio.toFixed(2)} 倍（细节散在外圈/背景杂乱）——先 --crop 裁主体再生成，否则固定网格被背景吃掉`)
  const offX = edgeCentroid.x - 0.5; const offY = edgeCentroid.y - 0.5
  if (Math.abs(offX) > 0.12 || Math.abs(offY) > 0.12) {
    hints.push(`subject-offset: 细节重心偏 (${offX > 0 ? '右' : '左'} ${Math.abs(offX).toFixed(2)}, ${offY > 0 ? '下' : '上'} ${Math.abs(offY).toFixed(2)})——裁切时把主体放到画面中心`)
  }
  return {
    size: `${w}x${h}`, megapixels: +(n / 1e6).toFixed(1),
    colorEntropy: +entropy.toFixed(2),
    uniqueQuant: buckets.size,
    edgeDensity: +edgeDensity.toFixed(3),
    subject: {
      centerEdgeDensity: +centerEdgeDensity.toFixed(3),
      edgeEdgeDensity: +edgeEdgeDensity.toFixed(3),
      ratio: +subjectRatio.toFixed(2),
      edgeCentroid
    },
    flatRatio: +flatRatio.toFixed(3),
    lumaSpread: Math.round(lumaMax - lumaMin),
    satAvg: +(satS / sampled).toFixed(2),
    dominantColors: top,
    hints
  }
}
