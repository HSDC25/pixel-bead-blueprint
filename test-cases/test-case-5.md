# test-case-5：输入格式兼容（progressive JPEG / EXIF 竖图 / 透明底）

> ⚠️ 本文件是**场景剧本**（流程叙事）；验收判据以 `functional.md` 对应条目为准——两边冲突时以 functional.md 为准。

## 场景

用户从网上下载图片（常是 progressive JPEG）、用手机竖拍（EXIF Orientation=6）、
或想拼透明底挂件。验证三条兼容路径。

## 输入

- `scripts/test/fixtures/progressive-mondrian.jpg`（progressive JPEG 样张）
- 任一 EXIF=6 的竖拍 JPEG（可用带 EXIF 的手机照片）
- 任一透明底 PNG（可用 `scripts/test/fixtures/tux-large-white_win.png` 加工出的透明底版本；管线完整消费 alpha，透明格 = 不放豆）

## 步骤

1. progressive：`node scripts/run.mjs scripts/test/fixtures/progressive-mondrian.jpg --grid 48 --out out-fmt`
   —— 观察日志出现「progressive JPEG：已用 <工具> 转 PNG 再解码」。
2. EXIF：直接喂竖拍原图 —— 日志出现「EXIF 方向 6：已按元数据转正」，产物为竖版（宽 < 高）。
3. 透明底：喂透明 PNG —— `blueprint.json` 出现 -1、`blueprint-ascii.txt` 空位为 `...`、
   `blueprint.png` 透明区 alpha=0，色号表没有「背景色」豆。

## 预期

- 三条路径都产出完整五件套，不抛「不支持 progressive」旧错误。
- 机器无任何转换器时，progressive 分支报**可读错误**（列出尝试过的工具与手工转格式建议），不是堆栈。
- 透明语义 = 空位（留孔不填豆），不是填白/填黑。

## 失败长什么样

- progressive 图直接被拒（转码链没生效）或转码后方向歪了（EXIF 没从原 JPEG 补回）。
- 透明区出现大量白豆/黑豆（alpha 语义回归）。
