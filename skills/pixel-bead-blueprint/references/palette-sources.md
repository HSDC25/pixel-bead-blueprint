# 色盘数据来源与许可（palette-sources）

> ⚠️ 所有 HEX/RGB 都是**屏幕近似值**，不是实验室测色值；采购前请用实体色卡校准。色号是各品牌的公开商品编号，本 skill 不冒充官方测量数据。

| 内置色盘 | 文件 | 色数 | 来源 | 许可 |
|---|---|---|---|---|
| MARD 221 | `palettes.json` → `mard` | 221 | APP `BeadPaletteLibrary`，源自 [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)（MARD 221 公开源码库版）；与仓库 `mard-221-github/colors.json` 逐色号核对一致 | MIT |
| MARD 291 | `palettes.json` → `mard291` | 291 | [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)（`mard-291-github/colors.json`） | MIT |
| Perler 118 | `palettes.json` → `perler` | 118 | [jsspace/bead-colors](https://github.com/jsspace/bead-colors)（Meltbead，`palettes/perler.js`；社区屏幕近似色） | MIT |
| Artkal C-197 | `palettes.json` → `artkal-c197` | 188 实色 | [HansBug/pindou-color-data](https://github.com/HansBug/pindou-color-data)（Artkal 官方 RGB PDF 整理）；9 个 8 位带 alpha 的透明/特殊色未纳入 | MIT |
| Artkal M-221 | `palettes.json` → `artkal-m221` | 220 实色 | 同上；1 个 8 位带 alpha 色未纳入 | MIT |

## 使用说明

- CLI：`--palette mard`（默认，221）/ `mard291` / `perler` / `artkal-c197` / `artkal-m221`，也可直接传同 schema 的自定义 JSON 路径。
- Perler 的官方产品码（如 `80-15179`）太长，格子内放不下 ⇒ 格子/图纸 JSON 用简写 `P1..P118`，`blueprint.md` 的「产品号」列给完整码，`blueprint.json` 的 `legend` 同时给出 `code/fullCode/name`。
- 自定义色盘 schema：
  ```json
  { "name": "我的库存色盘", "code": "my-stock", "colors": [
    { "c": "H7", "h": "010101", "f": "可选产品号", "n": "可选颜色名" }
  ] }
  ```

## 许可全文（MIT）

以下三个上游均为 MIT License。为满足署名要求，保留版权声明：

### HansBug/pindou-color-data

```
MIT License

Copyright (c) 2026 HansBug

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### jsspace/bead-colors (Meltbead)

```
MIT License

Copyright (c) 2026 Meltbead contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
