# 在线图片查看器

通过一个在线链接传入任意图片地址，即可查看图片详情，并支持**预览、旋转、鼠标滚轮缩放、平移、下载到本地**。

- 分享链接即用：`https://<你的域名>/?url=<图片地址>`
- 无构建、零前端依赖，一个 `index.html` + 一个 Vercel 无服务器函数
- 内置代理，解决图床 `Content-Type` 不正确、无 CORS 头导致**无法显示大小/格式、无法下载**的问题

示例（demo 图）：

```
http://localhost:3000/?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgordicaleksa%2Fpytorch-original-transformer%2Fmain%2Fdata%2Freadme_pics%2Ftransformer_architecture.PNG
```

## 功能

| 功能 | 说明 |
| --- | --- |
| 预览 | 图片居中显示，自动适应窗口 |
| 旋转 | 工具栏「左转 / 右转」90° 旋转，快捷键 `R` |
| 滚轮缩放 | 鼠标滚轮缩放，以**光标位置为锚点**；范围 2%–6000% |
| 平移 | 按住鼠标拖拽移动；双击恢复「适应窗口」 |
| 适应窗口 / 1:1 | 一键适配窗口，或回到原始尺寸 100% |
| 全屏 | 浏览器全屏查看 |
| 下载 | 一键下载原图到本地 |
| 图片详情 | 分辨率、文件大小、格式、文件名、当前缩放、原始链接（可复制） |

快捷键：`+` / `-` 缩放，`0` 适应窗口，`R` 旋转，`Esc` 退出全屏。

## 目录结构

```
image-viewer/
├── index.html        # 前端页面（预览 / 旋转 / 缩放 / 下载 / 详情面板）
├── api/
│   └── image.js      # Vercel 无服务器函数：图片代理
├── dev-server.js     # 本地开发服务器（仅本地用，部署时不参与）
├── package.json
├── vercel.json
└── README.md
```

## URL 参数

| 参数 | 说明 |
| --- | --- |
| `url` | 图片地址（推荐），需 `encodeURIComponent` 编码 |
| `u` / `src` / `image` | `url` 的别名 |

不带参数访问时会自动加载 demo 图。

## 代理 API

`GET /api/image?url=<图片地址>[&download=1]`

- `download=1`：返回 `Content-Disposition: attachment`，强制下载
- 方法：支持 `GET` / `HEAD`（`HEAD` 用于读取文件大小、格式等元数据）
- 响应头：`X-Image-Format`、`X-Image-Size`、`X-Image-Filename`、`Content-Type`

直接在浏览器或 `<img>` 中使用：

```html
<img src="https://<你的域名>/api/image?url=https%3A%2F%2Fexample.com%2Fa.png">
```

### 代理做了什么

1. **修正 Content-Type**：先按文件头 magic byte 嗅探（png/jpg/gif/webp/bmp/ico/svg/avif/heic），再退回上游响应头与扩展名。很多图床返回 `application/octet-stream`，浏览器无法可靠识别，代理会纠正为 `image/png` 等。
2. **补齐 CORS 头**：允许跨域读取，从而拿到文件大小/格式并实现下载。
3. **安全限制**：仅允许 `http/https`、仅允许 80/443 端口；对主机做 DNS 解析并拦截私网/环回/链路本地/云元数据地址（SSRF 防护）；单张图片最大 20 MB；上游请求 15 秒超时。

## 本地开发

需要 Node.js 18+。

```bash
node dev-server.js
# 打开 http://localhost:3000
```

或使用 Vercel 官方 CLI（更贴近线上环境）：

```bash
npx vercel dev
```

> 说明：直接双击 `index.html`（`file://` 协议）也能打开并用直连方式预览/旋转/缩放，但没有代理，无法读取文件大小/格式，下载按钮会改为在新标签页打开原图。

## 部署到 Vercel

### 方法一：GitHub 导入（推荐）

1. 把本项目推送到一个 GitHub 仓库（仓库根目录即为 `index.html` 所在目录）。
2. 访问 [vercel.com/new](https://vercel.com/new)，用 GitHub 登录并 **Import** 该仓库。
3. **Framework Preset** 选 `Other`，Build Command / Output Directory 均留空（纯静态 + `api/` 函数，无需构建）。
4. 点击 **Deploy**，完成后获得 `https://<项目名>.vercel.app`。
5. 之后每次 `git push`，Vercel 会自动重新部署。

### 方法二：Vercel CLI

```bash
npm i -g vercel
vercel          # 首次：登录并按提示创建项目（预览环境）
vercel --prod   # 部署到生产环境
```

### 使用

部署完成后，用如下链接查看图片（图片地址需 URL 编码）：

```
https://<项目名>.vercel.app/?url=https%3A%2F%2Fraw.githubusercontent.com%2Fgordicaleksa%2Fpytorch-original-transformer%2Fmain%2Fdata%2Freadme_pics%2Ftransformer_architecture.PNG
```

在页面里粘贴图片地址后点「查看」，再点「复制分享链接」，即可得到当前图片的分享 URL。

## 自定义域名（可选）

在 Vercel 项目 → **Settings → Domains** 添加你的域名，按提示配置 DNS 即可。

## 注意事项

- 代理接口为公开访问且 `Access-Control-Allow-Origin: *`，任何站点都可调用。若担心带宽被滥用，可在 `api/image.js` 中收紧 CORS 或将 `Access-Control-Allow-Origin` 改为你的域名，并在 Vercel 上配置用量告警。
- 若目标图床有防盗链（Referer 校验），可能出现 403，此时预览会提示加载失败。

## 许可证

MIT
