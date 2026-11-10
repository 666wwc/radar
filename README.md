# Radar · AI / 游戏 / 3D 行业资讯

一个自动更新的行业资讯聚合页：GitHub Actions 每小时抓取 RSS 源，生成静态数据，页面纯静态渲染。

**在线**：https://666wwc.github.io/radar/

## 结构

```
index.html              页面
assets/style.css        样式
assets/app.js           渲染：分类筛选、搜索、相对时间
scripts/fetch.mjs       抓取器（零依赖，只用 Node 内置 fetch）
data/items.json         生成的数据（由 Actions 提交）
.github/workflows/      每小时执行的抓取任务
```

## 本地跑

```bash
node scripts/fetch.mjs      # 抓一次，生成 data/items.json
node scripts/serve.mjs      # 本地预览 → http://127.0.0.1:4321
```

需要 Node 18+（用了内置 `fetch` 和 `AbortSignal.timeout`）。

## 数据源

只用各站官方 RSS / Atom，不解析 HTML、不绕过反爬。

| 分类 | 来源 |
|---|---|
| AI | OpenAI、Google AI、Hugging Face、TechCrunch AI |
| 游戏 | Polygon、Game Developer、Rock Paper Shotgun |
| 3D / CG | 80 Level、CG Channel、Blender |

改数据源直接编辑 `scripts/fetch.mjs` 顶部的 `SOURCES` 数组，加一条就行：

```js
{ id: 'example', name: 'Example', category: 'ai', url: 'https://example.com/feed.xml' }
```

`category` 只认 `ai` / `game` / `3d` 三个值；新增分类要在 `CATEGORY_LABELS` 里登记，并同步改页面上的筛选按钮。

## 行为说明

- **单个源失败不影响整体**：抓取记录每个源的结果，全部失败才退出（保留上次数据）
- **去重**：按链接去掉 `#`、`?` 和结尾斜杠后比对
- **截断**：每个分类最多 60 条，按发布时间倒序
- **摘要**：截断到 220 字符并剥掉 HTML

## 许可

代码 MIT。抓取到的内容版权归各原站所有，此处仅做标题与摘要的索引展示。
