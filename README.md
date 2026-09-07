# Storplan

Storplan 是一款存储容量与性能规划工具。输入容量和读写带宽需求，即可对比不同方案的集群规模、硬件配置与预估性能。规划结果可用于初步选型和询价，采购前请结合实际业务与厂商测试数据复核。

## 技术栈

- **TanStack Start** — 全栈 React 框架
- **TanStack Router** — 类型安全的文件路由
- **Tailwind CSS** — 样式
- **TypeScript** — 类型安全

## 支持的存储方案

- **XSKY XEOS** — 混闪对象存储
- **VastData** — 统一存储（NFS、SMB、S3、iSCSI、NVMe-oF）
- **GPFS ECE** — 高性能文件系统（全闪）
- **GPFS 混闪** — 大容量并行文件系统（NVMe 元数据与热数据层 + HDD 数据层，分别展示开启和关闭分层时的性能）
- **Weka** — 全闪并行文件系统
- **Ceph 全闪** — 开源统一存储（块、对象、文件系统）
- **Ceph 混闪** — 基于 HDD 与 NVMe SSD 的对象存储（RGW）

## AI 规划助手

点击右下角的「AI 规划助手」，即可通过多轮对话描述业务需求，例如数据量、接入协议、GPU 规模和预算。
助手会先确认关键条件，再推荐存储方案，并将容量与带宽参数填入页面顶部的规划表单。
AI 负责理解需求、选型和确定参数；集群规模与性能指标仍由本站的计算逻辑生成。

**先确认需求，再生成方案。** 规划结果可作为初步询价的参考，准确的前提至关重要。因此，助手默认先确认以下条件：

- 核对业务与数据形态、容量与增长、协议与接入方式、性能需求四项必要条件，只补充询问缺失的信息。
  每轮最多提问 3 个问题，并先复述「已知：…」，方便你检查和纠正。
- 每轮提问均提供**可直接点击的候选答案**，其中包括「按经验来，先给大概方案」，方便你跳过提问。
- 提问不超过 3 轮。尚未确认的条件会按常见值补齐，并标注为假设；你也可以随时说「按经验来」「你定」或「别问了」结束提问。
- 生成方案时，分别列出「已知条件」和「假设」，并在参数卡上逐条展示假设。点击候选答案（如「余量改成 20% 重算」），
  即可按调整后的条件重新规划。

助手仅回答存储、Kubernetes、网络、GPU 和 AI 基础设施相关问题；需要厂商参数等外部信息时，会联网检索。
自动填入表单的参数可以随时手动调整。

**对话框操作**：在桌面端，拖动标题栏可移动面板，拖动左上角手柄可调整大小，双击标题栏可恢复默认位置。
位置和尺寸保存在 localStorage 中。点击面板外部或按 Esc 可收起面板，再次打开时会保留消息和滚动位置。
面板展开和收起时，以右下角的助手按钮为中心播放缩放动画；启用 `prefers-reduced-motion` 时直接切换，不播放动画。
每张方案卡都会保留生成时的参数。若表单已被修改，点击「恢复参数并查看结果」即可恢复该方案并查看规划结果。

### 服务端配置

浏览器仅访问同源的 `/api/chat`。上游服务地址、API Key 和模型配置均由服务端读取，不应将密钥写入客户端代码或提交到仓库。

本地开发时，先复制配置模板，再填入自己的密钥（`.dev.vars` 已列入 `.gitignore`）：

```bash
cp .dev.vars.example .dev.vars
```

生产环境使用 Cloudflare Workers Secret 配置密钥，不要将其写入 `wrangler.toml`：

```bash
npx wrangler versions secret put LLM_API_KEY
npx wrangler versions secret put LLM_API_URL   # 可选，默认 https://api.blsc.dev
npx wrangler versions secret put LLM_MODEL     # 可选，默认 claude-opus-5
```

本项目采用版本化上传（`wrangler versions upload`），请注意：

1. 使用 `wrangler versions secret put`，而非 `wrangler secret put`；存在未部署版本时，后者会被拒绝。
2. **每个版本的绑定在上传时确定**。已上传的预览版本不会自动获取后续添加的 Secret。
   添加 Secret 后，需要重新执行 `npx wrangler versions upload`，否则预览环境仍会提示助手尚未配置。

未配置 `LLM_API_KEY` 时，助手会提示联系管理员完成配置，页面其他功能不受影响。

限流器通过 Workers 绑定访问，而非 `process.env`。运行 TypeScript 类型检查前，请先生成 Workers 类型：

```bash
npm run cf-typegen   # 生成 worker-configuration.d.ts（已 gitignore）
```

### 限流

`/api/chat` 是公开端点，每次提问都会消耗上游服务额度。因此，项目采用两层限流：自有域名上的 WAF 规则提供主要防护，
Worker 内的限流绑定提供补充防护，并覆盖预览域名。

`wrangler.toml` 中配置了两项限流绑定。触发限流后，接口返回 HTTP 429，页面显示相应提示，不影响手动调整规划参数：

| 绑定 | 计数键 | 限额 |
|---|---|---|
| `CHAT_IP_LIMITER` | 调用方 IP（`CF-Connecting-IP`） | 8 次 / 分钟 |
| `CHAT_GLOBAL_LIMITER` | 全站共用 | 60 次 / 分钟 |

限流在解析请求体之前执行；绑定缺失或限流服务异常时放行，不影响正常提问。

**限流绑定的防护边界（项目实测）**：计数缓存在处理请求的机器上，并异步同步，属于「宽松、最终一致」的限流机制。
项目测试中，复用同一条 TCP 连接连续请求时，第 8 次请求被拦截；每次新建连接连续请求 20 次时，则全部通过。
请求可能由不同机器处理，分别计数，因此限流效果会受连接方式影响，**不能依靠绑定层阻止通过反复重连发起的请求**。

因此，自有域名另设一层 WAF 限流，作为主要防护措施。

### 自有域名 WAF 限流

WAF 限流在**边缘按 colo 计数**。被拦截的请求不会进入 Worker，也不会消耗上游服务额度。
使用以下脚本创建规则；若同名规则已存在，脚本会更新该规则，可重复执行：

```bash
CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs --dry-run  # 先看将要提交的规则
CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs            # 应用
```

Token 需要 Zone → Zone → Read 与 Zone → WAF → Edit，范围限定到该 zone 即可。
默认作用于 `storplan.wutz.dev` 的 `/api/chat`，可用 `ZONE_NAME` / `HOSTNAME` / `TARGET_PATH` 覆盖。

不同套餐支持的限流能力不同，脚本会根据 zone 的实际套餐选择可用参数：

| 套餐 | 规则数 | 窗口 | 计数维度 | 表达式字段 | 脚本采用 |
|---|---|---|---|---|---|
| Free | 1 | 固定 10s | 仅 IP | 仅 Path（**不能匹配主机名**） | 2 次 / 10s，封禁 10s |
| Pro | 2 | ≤ 1min | 仅 IP | 加 Host / URI / Query | 8 次 / 60s，封禁 60s |
| Business+ | 5+ | ≤ 10min | IP（含 NAT） | 加 Method / 源 IP / UA | 8 次 / 60s，封禁 300s |

Free 套餐下，规则只能按路径匹配，因此会对该 zone 下所有主机名的 `/api/chat` 生效。
本项目所在 zone 仅此站点使用该路径；如果其他站点也使用相同路径，请注意规则的影响范围。

**仍需注意以下限制**：WAF 限流不能替代费用上限控制。

1. **不覆盖预览域名**：WAF 仅对自有域名生效，`*.workers.dev` 仍依赖 Worker 内的限流绑定。预览域名用于 PR
   验证，不对外公布。如不再需要该访问入口，可在生产环境切换到自有域名后关闭 `workers_dev`。
2. **限制请求速率，而非总量**：`wutz.dev` 使用 Free 套餐，计数窗口固定为 10 秒。即使限制为每 10 秒 1–2 次，
   单个 IP 每天仍可能发起上万次请求，每次请求都会调用 Opus。若需严格控制费用，还应设置上游 API Key 额度，
   使用 Durable Object 管理每日配额，或为助手增加访问控制（Turnstile / 登录）。

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

- [Storpath](https://storpath.wutz.dev/) —— 面向存储运维工程师的交互式学习路径（[源码](https://github.com/wutz/storpath)）。L3「容量与性能规划」介绍了本工具所用容量与性能计算口径的推导过程。
