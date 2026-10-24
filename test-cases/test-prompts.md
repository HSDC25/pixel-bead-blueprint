# test-prompts.md — 可直接粘贴的触发语

| # | 触发语（粘给 agent） | 预期走的路径 | 对应叙述用例 |
|---|---|---|---|
| 1 | 「教我拼拼豆，用这张照片」（附任意照片） | 六步辅导环全流程（工作流 A + --teach） | test-case-1 |
| 2 | 「这张图太大了，帮我切成能分天拼的图纸」（附大图） | 工作流 A + --split/--block + 分块场次 | test-case-2 |
| 3 | 「识别一下这张成品用了哪些色号，之后只用我有的颜色拼」（附成品照） | 工作流 B：--scan → --inventory | test-case-3 |
| 4 | 「这两个参数哪版好？帮我看着调」（附同一张图） | 大模型推理环：--analyze + compare.png 对比回调 | test-case-4 |
| 5 | 「这张手机拍的竖图/网上下的图能拼吗」（附 progressive JPEG 或带 EXIF 图） | 格式兼容：自动转码 + EXIF 转正 | test-case-5 |

## 一键自检命令（不依赖 agent，先验管线本体；在提交包根目录执行）

```bash
node --test scripts/test/run.mjs    # 合成图全量 46 项（实测通过）
```
