/**
 * teaching.js — AI 辅导层：从图纸数据推导「难度评定 + 工时 + 备料 + 场次里程碑 + 专属易错点 + 辅导问题 + 反馈手册」
 *
 * 定位：本模块只做【数据 → 结构化教学计划】，不做对话——讲解、互动、激励由 agent 承担。
 * coach.md 是 agent 的辅导底稿：agent 照着它提问、开场、复盘，而不是把整份文档念给学员。
 *
 * 输入（buildTeachingPlan）：
 *   { fileName, paletteName, w, h, colors, beads, empty, speckleRate, top5Share,
 *     dither('nearest'|'fs'), outline, sensitive, flat, splitSize,
 *     blocks: [{block,row0,row1,col0,col1,beads,top:[{code}]}] | null,   // --split 时传入
 *     level('auto'|'beginner'|'intermediate'|'advanced'), sessionMinutes }
 *
 * 手工工时经验值（拼豆社区常见口径，用于估算而非承诺）：
 *   beginner ~600 颗/h（边找边拼、频繁核对）/ intermediate ~1000 / advanced ~1500
 */

export function buildTeachingPlan (inp) {
  const cells = inp.w * inp.h
  const level = inp.level === 'auto' || !inp.level ? assessLevel(inp) : inp.level
  const beadsPerHour = { beginner: 600, intermediate: 1000, advanced: 1500 }[level] || 800
  const ditherSlow = inp.dither === 'fs' ? 1.15 : 1 // 抖动图近似色多，核对更频繁
  const hours = inp.beads / (beadsPerHour / ditherSlow)
  const sessionMinutes = Math.max(20, inp.sessionMinutes || 90)
  const sessions = Math.max(1, Math.ceil(hours * 60 / sessionMinutes))

  return {
    fileName: inp.fileName,
    paletteName: inp.paletteName,
    grid: { w: inp.w, h: inp.h, cells },
    stats: { colors: inp.colors, beads: inp.beads, empty: inp.empty, speckleRate: inp.speckleRate, top5Share: inp.top5Share },
    pipeline: { dither: inp.dither, outline: !!inp.outline, sensitive: !!inp.sensitive, flat: !!inp.flat, splitSize: inp.splitSize || 0 },
    level,
    levelReasons: inp.level === 'auto' || !inp.level ? assessReasons(inp) : [`学员自报档位：${level}`],
    pace: { beadsPerHour, hours: +hours.toFixed(1), sessionMinutes, sessions },
    sessionsPlan: planSessions(inp, sessions),
    mistakes: tailoredMistakes(inp),
    aiQuestions: aiQuestions(inp),
    playbook: feedbackPlaybook(inp)
  }
}

// ---------- 难度评定（可解释评分：规模/色数/杂点/抖动 四维） ----------
function assessLevel (inp) {
  let score = 0
  const cells = inp.w * inp.h
  score += cells <= 2500 ? 1 : cells <= 6400 ? 2 : cells <= 14400 ? 3 : 4
  score += inp.colors <= 10 ? 1 : inp.colors <= 20 ? 2 : inp.colors <= 32 ? 3 : 4
  if (inp.speckleRate > 0.05) score += 1
  if (inp.dither === 'fs') score += 1
  return score <= 5 ? 'beginner' : score <= 9 ? 'intermediate' : 'advanced'
}
function assessReasons (inp) {
  const cells = inp.w * inp.h
  const r = []
  r.push(`网格 ${inp.w}×${inp.h} = ${cells} 格（${cells <= 2500 ? '小' : cells <= 6400 ? '中' : cells <= 14400 ? '大' : '超大'}规模）`)
  r.push(`用色 ${inp.colors}（${inp.colors <= 10 ? '少' : inp.colors <= 20 ? '中' : inp.colors <= 32 ? '较多' : '多'}）`)
  if (inp.speckleRate > 0.05) r.push(`孤点率 ${(inp.speckleRate * 100).toFixed(1)}%：小用量色多，拼制时找豆费眼`)
  if (inp.dither === 'fs') r.push('FS 抖动：相邻格近似色密集，需频繁核对')
  return r
}

// ---------- 场次规划：有分块按块分场（备色取每块 top 色），否则按行段分场 ----------
function planSessions (inp, sessions) {
  const out = []
  if (inp.blocks && inp.blocks.length > 0) {
    const per = Math.ceil(inp.blocks.length / sessions)
    for (let s = 0; s * per < inp.blocks.length; s++) {
      const group = inp.blocks.slice(s * per, (s + 1) * per)
      const beads = group.reduce((a, b) => a + b.beads, 0)
      const codes = [...new Set(group.flatMap(b => b.top.map(t => t.code)))]
      out.push({
        no: s + 1,
        scope: `块 ${group.map(b => b.block).join('、')}（行 ${group[0].row0}~${group[group.length - 1].row1}）`,
        beads,
        prep: codes,
        verify: `对照 sheet-blocks.md 行/列范围，${group.map(b => `block-${b.block}`).join('、')} 拼完逐块校验`
      })
    }
  } else {
    const rowsPer = Math.max(1, Math.ceil(inp.h / sessions))
    for (let s = 0; s * rowsPer < inp.h; s++) {
      const y0 = s * rowsPer + 1
      const y1 = Math.min(inp.h, (s + 1) * rowsPer)
      out.push({
        no: s + 1,
        scope: `行 ${y0}~${y1}（共 ${y1 - y0 + 1} 行）`,
        beads: Math.round(inp.beads * (y1 - y0 + 1) / inp.h),
        prep: [],
        verify: `对照 sheet.png 行 ${y0}~${y1}（或 blueprint-ascii.txt 对应行）逐行核数`
      })
    }
  }
  return out
}

// ---------- 该图专属易错点（条件生成，不是通用教训堆砌） ----------
function tailoredMistakes (inp) {
  const m = []
  if (inp.dither === 'fs') {
    m.push('抖动区相邻格是近似色（这是有意的渐变纹理，不是拼错）：拼错一格时先看上下行是否同纹路，不要整片拆。')
    m.push('抖动图熨烫时隔一层烘焙纸、温度宁低勿高，防止浅色豆被周围深色串色。')
  }
  if (inp.empty > 0) m.push(`本图有 ${inp.empty} 个空位（透明=空位）：底板对应孔位留空不填豆，填了会改变轮廓。`)
  if (inp.speckleRate > 0.05) m.push('小用量色（≤2 颗的色号）多：开工前把它们单独分装标注，随取随用，避免拼到一半到处找。')
  if (inp.colors > 24) m.push('用色超过 24：按色号表「颗数」列降序备豆，占比最高的色按整包备。')
  if (inp.outline) m.push('描边已开：加深色是轮廓格，先拼轮廓再填内部，定位更快。')
  if (inp.sensitive) m.push('肤色保护已开：人物肤色区只在同色相族内选色，不要手工替换成「更顺眼」的色。')
  if (inp.splitSize >= 16) m.push('分块拼接处（每块最末行/列）注意跨块对齐：blocks-index.json 里的行列号是全局坐标，块间不重不漏。')
  if (inp.top5Share > 70) m.push('Top5 色占了绝大多数豆：把这几个色的分装盒放在触手可及处，其余色收远一点。')
  if (m.length === 0) m.push('本图无特殊坑（少量色 + 无抖动 + 无空位），适合熟悉基本流程。')
  return m
}

// ---------- AI 辅导问题（agent 开场用，收集个性化信息） ----------
function aiQuestions (inp) {
  return [
    { q: '你之前拼过拼豆吗？最大完成过多少格的作品？', why: '校准难度档位——若学员是新手而本图评到 advanced，主动建议降网格重跑（--grid 减一档）' },
    { q: '每次大概能连续拼多久？打算几天完成？', why: '当前按每场 ' + (inp.sessionMinutes || 90) + ' 分钟排了场次，可按回答重排' },
    { q: '有没有辨色困扰（色弱/灯光偏色）？', why: '有 → 建议加 --sensitive 1 重跑，并把色号表换成「名称+HEX」对照' },
    { q: '色豆库存是现成的还是要新买？', why: '现成 → 走工作流 B（--inventory）先做缺色分析再开工，避免拼一半缺豆' }
  ]
}

// ---------- 反馈应对手册（给 reasoning，不给死查表——agent 按思路临场判断） ----------
function feedbackPlaybook (inp) {
  return [
    { when: '「拼到一半发现错位了」', think: '不要整片拆。找最近的一段连续同色行当锚点往回数；有 blueprint-ascii.txt 就 grep 该行核对。若错位超过 3 行才考虑拆段重拼。' },
    { when: '「两个色号看起来一样」', think: '先看 sheet.png 图例的 HEX 差异，真近似（ΔE<5）才考虑 --maxcolors 归并重跑；否则是环境光问题，换白光灯再看。' },
    { when: '「拼完感觉不像原图」', think: '先看 compare.png 区分两类根因：整体抽象 = 网格不够（重跑加大 --grid，别改色）；个别区域颜色错 = 行内错位/错号，用 ASCII 矩阵逐行核。' },
    { when: '「这种色不够了」', think: '别停工：走工作流 B --inventory 做缺色分析，取 ΔE 最近的库存色先拼低显眼区；ΔE>8 的替代表面会变色，只用在背景/暗部。' },
    { when: '「拼错了但已经熨了」', think: '已熨区域不可逆。评估错的是不是孤立格——是就贴同色补丁豆再熨一次局部；不是则告知学员返工范围，别美化。' }
  ]
}

// ---------- 渲染 ----------
export function renderCoachingMarkdown (plan) {
  const lv = { beginner: '入门', intermediate: '进阶', advanced: '挑战' }[plan.level] || plan.level
  const L = []
  L.push(`# 拼豆辅导计划 — ${plan.fileName}`)
  L.push('')
  L.push(`> 色盘: ${plan.paletteName} | 网格: ${plan.grid.w}×${plan.grid.h}（${plan.grid.cells} 格）| 用色 ${plan.stats.colors} | 总颗数 ${plan.stats.beads}`)
  L.push('> 本文件是 AI 辅导的底稿：讲解、互动、复盘由 AI 对话完成；这里定难度、工时、场次与校验点。')
  L.push('')
  L.push('## 1. 难度评定')
  L.push('')
  L.push(`**综合档位：${lv}**`)
  L.push('')
  for (const r of plan.levelReasons) L.push(`- ${r}`)
  L.push('')
  L.push('## 2. 工时与场次')
  L.push('')
  L.push(`按 ${plan.level} 档 ${plan.pace.beadsPerHour} 颗/小时 估算，总工时约 **${plan.pace.hours} 小时**；每场 ${plan.pace.sessionMinutes} 分钟 ⇒ 建议 **${plan.pace.sessions} 场**。`)
  L.push('')
  L.push('> 估算含找豆与核对时间，仅供参考；第一次拼建议只排前 2 场，实测速度后再排后面的。')
  L.push('')
  L.push('## 3. 场次与里程碑')
  L.push('')
  L.push('| 场 | 范围 | 约颗数 | 本场校验点 |')
  L.push('|---|---|---|---|')
  for (const s of plan.sessionsPlan) {
    L.push(`| ${s.no} | ${s.scope} | ~${s.beads} | ${s.verify} |`)
  }
  L.push('')
  L.push('## 4. 该图专属易错点')
  L.push('')
  for (const m of plan.mistakes) L.push(`- ${m}`)
  L.push('')
  L.push('## 5. 开场辅导问题（AI 首次对话时逐个问）')
  L.push('')
  for (const q of plan.aiQuestions) L.push(`- **${q.q}**（为什么问：${q.why}）`)
  L.push('')
  L.push('## 6. 反馈应对思路（AI 按思路临场判断，不照本宣科）')
  L.push('')
  for (const p of plan.playbook) L.push(`- 学员说 **${p.when}** → ${p.think}`)
  L.push('')
  L.push('## 7. 完工复盘与库存回收')
  L.push('')
  L.push('- 完工后对照 `compare.png` 复盘：哪里最像（可夸具体处）、哪里最抽象（说清是网格档位决定的，不是学员拼错）。')
  L.push('- 剩余散豆回收：拍一张排好的成品照或色卡照 → `node scripts/run.js <照片> --scan 库存.json --cols N --rows N` 更新库存色盘。')
  L.push('- 下一次的难度递进：本图档位是 ' + lv + '，下次同工时可上探一档网格或一档色数。')
  L.push('')
  L.push('## 8. 进度打卡')
  L.push('')
  for (const s of plan.sessionsPlan) L.push(`- [ ] 第 ${s.no} 场（${s.scope}）`)
  L.push('- [ ] 熨烫完成')
  L.push('- [ ] 复盘 + 库存回收')
  L.push('')
  return L.join('\n')
}
