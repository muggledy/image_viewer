# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

在线图片查看器：通过 `?url=` 参数传入图片地址，查看图片详情并支持预览、旋转、滚轮缩放、平移、下载。部署在 Vercel。

**无构建、无依赖、无框架。** 只有两个部署单元：`index.html`（静态首页，Vercel 直接从仓库根目录发布）和 `api/image.js`（Vercel Node 无服务器函数）。`dev-server.js` 仅供本地开发，不参与线上运行。

## 常用命令

没有 build / lint / test 工具链，改动靠下面两条路径验证：

```bash
# 本地开发（零依赖，模拟“静态托管 + /api/image 函数”）
node dev-server.js            # → http://localhost:3000
PORT=3101 node dev-server.js  # 换端口（3000 被占用时）

# 直接验证代理函数
curl -sI "http://localhost:3000/api/image?url=<URL编码后的图片地址>"
curl -s  "http://localhost:3000/api/image?url=<...>&download=1" -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n"

# 前端 JS 没有 linter，用这个做语法检查（index.html 的内联脚本）
node -e 'const fs=require("fs");fs.writeFileSync("_c.js",fs.readFileSync("index.html","utf8").match(/<script>([\s\S]*?)<\/script>/)[1])' \
  && node --check _c.js && rm -f _c.js

# 部署
npx vercel --prod             # 或用 git push 触发 Vercel 自动部署
```

服务端逻辑可以脱离 HTTP 直接测：在 Node 里 require `api/image.js`，传入手写的 mock `req`/`res`（`dev-server.js` 已演示如何补 `res.status/send/json`）。

Vercel 导入项目时：Framework Preset 选 **Other**，Build Command / Output Directory / Root Directory 全部留空。

## 架构与数据流

```
浏览器 ?url=<图址>
   └─ index.html 把 img.src 指向 ./api/image?url=<图址>
        └─ api/image.js 在服务端抓取上游图片，纠正响应头后回传
```

### 为什么必须有这个代理（跨文件的关键原因）

很多图床（包括默认示例图）返回 `content-type: application/octet-stream` 且**不带 CORS 头**。这会导致：浏览器渲染不可靠、JS 读不到文件大小/格式、跨域 `<a download>` 失效。代理负责：

1. 按**文件头 magic byte 嗅探**真实格式，纠正 Content-Type（`detectFormat` 的优先级：magic byte → 上游 content-type → 扩展名映射，顺序不能颠倒）
2. 补 `Access-Control-Allow-Origin`
3. `download=1` 时返回 `Content-Disposition: attachment`，实现真正的一键下载
4. 通过自定义头 `X-Image-Format` / `X-Image-Size` / `X-Image-Filename` 暴露元数据

详情面板的"大小/格式/文件名"来自前端对代理发的一次 **HEAD 请求**读这些头，**不是**从 `<img>` 元素推出来的。

### 代理的安全约束（改动前先想清楚）

`api/image.js` 是一个公开的、可被任意站点调用的图片代理。约束不要随意放宽：仅 `http/https`、仅 80/443 端口、DNS 解析后拦截私网/环回/链路本地/云元数据地址（SSRF 防护）、单图 20MB 上限、上游 15s 超时。

`vercel.json` 里 `maxDuration: 30`；若 Hobby 计划报超时限制，改小即可。

## 前端要点（单文件 IIFE，无模块）

### 视图状态与坐标不变量（改动前必读）

全部视图状态就是 `state = { scale, tx, ty, rot }`，所有渲染都收敛到 `apply()` 写出的**单个 CSS transform**。

**关键不变量**：`<img>` 用 flexbox 居中，且 `transform-origin: center center`，因此图片"未变换时的中心"与舞台中心重合。`zoomAt` 的光标锚定缩放公式依赖这一点：

```
t' = m - k·(m - t)      // m = 光标相对“舞台中心”的偏移，k = 新scale/旧scale
```

推导中旋转项会相消，所以旋转后光标锚定依然成立。**如果改掉居中方式**（例如换回 `position:absolute` + `translate(-50%,-50%)`），会引入一个常数偏移，导致锚点公式失效——不要动这个布局。

### pointer 事件陷阱（已经因此出过 3 个 bug）

`.toolbar` 位于 `.stage` **内部**，所以按钮上的指针事件会冒泡到 `stage`。必须同时守住两处，两处都用 `e.target.closest('button, .toolbar')` 判断：

- **`pointerdown`**：按钮按下时**不能**对 `stage` 调 `setPointerCapture()`。一旦捕获，后续 `click` 会被重定向到 stage，工具栏所有按钮静默失效。
- **`dblclick`**：手势发生过实际拖动（`dragMoved`）或落在按钮上时**不能**执行 `fit()`。否则"按住-拖-松开"连续操作会被判定为双击，把图片复位，表现为"拖不动"或"缩着缩着跳回默认大小"。

拖拽的 `pointermove/up/cancel` **故意挂在 `window` 上而非 `stage`**，这样不依赖 `setPointerCapture` 成功、指针移出画布也能持续跟随。改动拖拽时保留这个结构。

### 其它

- `?url=` 的别名：`u` / `src` / `image`；无参数时加载 `DEMO_URL` 常量指向的默认图。
- `canProxy` 回退：以 `file://` 直接打开 index.html 时没有后端，预览退化为直连原图，大小/格式/下载不可用。依赖代理的功能要考虑这个分支。
- 旋转是 90° 递进（`rotate`），并会自动重新 `fit()`。缩放下限 2%，到下限后 `k=1`，点击不再产生任何变化。

## 环境注意事项

- 仓库用 LF；Windows 下 `git commit` 会有 CRLF 警告，无害。
- Windows / Git Bash 下 Node 里的 `/tmp/...` 会解析成 `C:\tmp`，脚本里用仓库内相对临时文件更稳。
- `.gitignore` 排除了 `.claude/`、`.vercel/`。
