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

**先问清，再规划。** 规划结果是能拿去询价的配置，用错的前提算出来的配置比不算更糟，所以助手默认先澄清需求：

- 按需求清单核对四项必要条件（业务与数据形态、容量与增长、协议与接入方式、性能诉求），缺哪项问哪项，
  一轮最多问 3 个，开头先复述「已知：…」让你能当场纠错。
- 每轮提问都带**可点选的候选答案**，不用打字；其中总有一个「按经验来，先给大概方案」的兜底选项。
- 提问不超过 3 轮，问不清的项用行业常见值补齐并标注为假设。你说「按经验来 / 你定 / 别问了」会立刻停止提问。
- 出方案时正文分「已知条件」与「假设」两块，假设逐条列在参数卡上，点一下候选答案（如「余量改成 20% 重算」）
  就能让它按新前提重算。

其它：话题限定在存储、Kubernetes、网络、GPU、AI 基础设施，其它问题会被拒答；需要厂商参数等站外信息时会联网检索；
填进表单的参数随时可以手改。

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

`/api/chat` 是公开端点，每次提问都消耗上游额度，所以做了两层限流：自有域上的 WAF 规则是主闸门，
Worker 内的限流绑定兜住预览域。

先说绑定层 —— `wrangler.toml` 里两道，命中后返回 429（页面上显示为一条提示，不影响继续改参数）：

| 绑定 | 计数键 | 限额 |
|---|---|---|
| `CHAT_IP_LIMITER` | 调用方 IP（`CF-Connecting-IP`） | 8 次 / 分钟 |
| `CHAT_GLOBAL_LIMITER` | 全站共用 | 60 次 / 分钟 |

限流在解析请求体之前执行；绑定缺失或限流服务异常时放行，不影响正常提问。

**绑定这层的强度边界（实测）**：限流绑定的计数缓存在处理请求的那台机器上、异步同步，官方定性为
「宽松、最终一致」。实测：复用同一条 TCP 连接连发时第 8 次被拦；而每次新建连接连发 20 次全部放行
—— 请求落到不同机器，各自从零计数。所以它挡得住浏览器和保持连接的脚本，**挡不住每次重连的脚本**。

因此自有域上再加一层 WAF 限流，作为真正的闸门。

### 自有域 WAF 限流（主闸门）

WAF 限流在**边缘按 colo 计数**，且在请求进入 Worker 之前就拦下来，不消耗上游额度。
用脚本创建，幂等（已存在同名规则则更新）：

```bash
CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs --dry-run  # 先看将要提交的规则
CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs            # 应用
```

Token 需要 Zone → Zone → Read 与 Zone → WAF → Edit，范围限定到该 zone 即可。
默认作用于 `storplan.wutz.dev` 的 `/api/chat`，可用 `ZONE_NAME` / `HOSTNAME` / `TARGET_PATH` 覆盖。

脚本会按 zone 的实际套餐挑合法参数，因为各套餐能力差别很大：

| 套餐 | 规则数 | 窗口 | 计数维度 | 表达式字段 | 脚本采用 |
|---|---|---|---|---|---|
| Free | 1 | 固定 10s | 仅 IP | 仅 Path（**不能匹配主机名**） | 3 次 / 10s，封禁 10s |
| Pro | 2 | ≤ 1min | 仅 IP | 加 Host / URI / Query | 8 次 / 60s，封禁 60s |
| Business+ | 5+ | ≤ 10min | IP（含 NAT） | 加 Method / 源 IP / UA | 8 次 / 60s，封禁 300s |

Free 套餐下规则只能按路径匹配，会对该 zone 所有主机名的 `/api/chat` 生效 —— 本项目只有这一个站
用这个路径，实际无影响。

**仍然存在的缺口**：WAF 只对自有域生效，`*.workers.dev` 预览域绕过它，只剩绑定那层兜底。
预览域是给 PR 验证用的、不对外公布；如果要彻底堵死，把生产切到自有域后关掉 `workers_dev`。

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
