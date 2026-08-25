# Storplan

存储容量和性能规划工具。支持多种存储方案的容量、性能计算和方案对比。

## 技术栈

- **TanStack Start** — 全栈 React 框架
- **TanStack Router** — 类型安全的文件路由
- **Tailwind CSS** — 样式
- **TypeScript** — 类型安全

## 支持的存储方案

- **XSKY XEOS** — 对象存储
- **VastData** — 统一存储（NFS、SMB、S3、iSCSI、NVMe-oF）
- **GPFS ECE** — 高性能文件系统（全闪）
- **GPFS 混闪** — 大容量并行文件系统（NVMe 元数据层 + HDD 数据层，分别给出开启 / 关闭分层的性能）
- **Ceph** — 开源统一存储（块、对象、文件系统）

## AI 规划助手

右下角的「AI 规划助手」支持多轮对话：用自然语言描述业务需求（数据量、协议、GPU 规模、预算约束），
模型问清关键条件后选出方案、定出容量与带宽，参数自动填进页面顶部的规划表单，由本站既有的计算逻辑出结果 ——
模型只负责选型与定参，集群规模和性能数字仍由本地算法计算。

- 话题限定在存储、Kubernetes、网络、GPU、AI 基础设施，其它问题会被拒答。
- 需要厂商参数等站外信息时模型会联网检索。
- 模型输出的参数会在对话里以「已填入规划参数」卡片摊开展示，可直接在表单里改。

### 配置（密钥只留在服务端）

浏览器只访问同源的 `/api/chat`，上游地址、API Key、模型名都留在服务端，不进客户端产物、不进仓库。

本地开发 —— 复制模板后填入自己的密钥（`.dev.vars` 已被 `.gitignore` 忽略）：

```bash
cp .dev.vars.example .dev.vars
```

生产环境（Cloudflare Workers）—— 用 Secret 下发，不要写进 `wrangler.toml`：

```bash
npx wrangler versions secret put LLM_API_KEY
npx wrangler versions secret put LLM_API_URL   # 可选，默认 https://api.blsc.dev
npx wrangler versions secret put LLM_MODEL     # 可选，默认 claude-opus-5
```

本项目走版本化上传（`wrangler versions upload`），有两点要注意：

1. 用 `wrangler versions secret put`，不是 `wrangler secret put` —— 后者在有未部署版本时会被拒绝。
2. **每个版本在上传那一刻就固定了自己的绑定**。先上传的预览版本不会自动获得之后添加的 Secret，
   加完 Secret 要重新 `npx wrangler versions upload` 才能生效，否则预览会一直报「服务端缺少 LLM_API_KEY」。

未配置 `LLM_API_KEY` 时助手会直接返回「未配置」提示，页面其余功能不受影响。

绑定类型（限流器）不走 `process.env`，需要生成 Workers 类型后再 `tsc`：

```bash
npm run cf-typegen   # 生成 worker-configuration.d.ts（已 gitignore）
```

### 限流

`/api/chat` 是公开端点，每次提问都消耗上游额度，因此在 `wrangler.toml` 里配了两道
Cloudflare 限流绑定，命中后返回 429（页面上显示为一条提示，不影响继续改参数）：

| 绑定 | 计数键 | 限额 |
|---|---|---|
| `CHAT_IP_LIMITER` | 调用方 IP（`CF-Connecting-IP`） | 8 次 / 分钟 |
| `CHAT_GLOBAL_LIMITER` | 全站共用 | 60 次 / 分钟 |

限流在解析请求体之前执行；绑定缺失或限流服务异常时放行，不影响正常提问。

**强度边界（实测）**：限流绑定的计数缓存在处理请求的那台机器上、异步同步，官方定性为
「宽松、最终一致」。在预览环境实测：复用同一条 TCP 连接连发时第 7 次即被拦；
而每次新建连接连发 20 次全部放行 —— 请求落到不同机器，各自从零计数。

也就是说这道闸门挡得住浏览器和保持连接的脚本连续刷量，**挡不住每次重连的分布式刷量**。
需要精确限额时，两条路：

- 把站点挂到自有域名（如 `wutz.dev` 的子域）后加 WAF 限流规则 —— 按 colo 计数，零代码，
  但对 `*.workers.dev` 预览域不生效；
- 用 Durable Object 做精确计数 —— 对预览域同样有效，代价是每次请求多一跳。

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

访问 <http://localhost:3000>

## 项目结构

```
storplan/
├── src/
│   ├── components/
│   │   └── ai-assistant.tsx      # AI 规划助手对话面板
│   ├── lib/                      # 核心计算逻辑
│   │   ├── utils.ts              # 容量/带宽解析工具
│   │   ├── xeos.ts               # XEOS 规划器
│   │   ├── storage-catalog.ts    # 方案知识库（页面与 AI 提示词共用）
│   │   ├── ai-chat.ts            # 对话契约与规划指令解析
│   │   └── ai-system-prompt.ts   # AI 系统提示词（仅服务端）
│   ├── routes/                   # 路由页面
│   │   ├── __root.tsx            # 根布局
│   │   ├── index.tsx             # 首页（规划表单）
│   │   └── api.chat.ts           # POST /api/chat（LLM 流式代理）
│   ├── router.tsx                # 路由配置
│   └── styles.css                # 全局样式
├── dist/                # 构建输出
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 部署

### Cloudflare Workers

通过 `wrangler` CLI 手动部署：

```bash
npm run deploy
```

## 相关项目

- [Storpath](https://storpath.wutz.dev/) —— 存储运维工程师成长路径，交互式课程（[源码](https://github.com/wutz/storpath)）。本工具算出的容量与性能口径，在那边的 L3「容量与性能规划」里有推导过程。
