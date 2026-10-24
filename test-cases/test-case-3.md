# test-case-3：工作流 B 库存闭环（成品照 → 库存 → 限定生成 → 缺色）

> ⚠️ 本文件是**场景剧本**（流程叙事）；验收判据以 `functional.md` 对应条目为准——两边冲突时以 functional.md 为准。

## 场景

用户手里有一批豆，拍了一张排好的成品照/色卡照，想「只用我有的颜色」生成新图纸。

## 输入

- 网格成品图：`scripts/test/fixtures/mondrian-1930-cii-original.jpg`（`scripts/test/run.mjs` 的投影网格检测即用此样张；或自备带间隙的色卡截图）
- 派生库存：第一步 `--scan` 的输出 JSON

## 步骤

1. `node scripts/run.mjs scripts/test/fixtures/mondrian-1930-cii-original.jpg --scan inventory.json`
2. 用一张新照片限定生成：`node scripts/run.mjs <照片> --inventory inventory.json --grid 64 --out out-b`
3. 再加 `--limit-palette` 跑一版：`--inventory inventory.json --limit-palette --grid 64 --out out-b-limited`
4. 对比两版 `blueprint.md` 的「库存覆盖与缺色」段。

## 预期

- 步骤 1 打印匹配表（取样 RGB / 色号 / HEX / ΔE / 置信度）并写 `inventory.json`（含 codes/legend/grid.mode）。
- 色卡截图带间隙时，日志出现「投影检出」（`grid.mode='projection'`）而不是网格检测失败。
- 步骤 2/3 的 `blueprint.md` 有缺色表：缺色号 / HEX / 需补颗数 / 最接近库存色 / ΔE。
- `--limit-palette` 版缺色为 0（全部落在库存内），未限定版如实列出缺口。

## 失败长什么样

- 传普通照片却扫出库存（门禁没拦，工作流 B 结构性拒绝失效）。
- 低置信色号被静默写入库存（必须先拒并提示 `--accept-low-confidence`）。
- 带间隙色卡直接报「网格检测失败」（投影检测未生效）。
