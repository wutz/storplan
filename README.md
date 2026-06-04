# Storplan

存储容量和性能规划工具。支持多种存储方案的容量、性能计算和方案对比。

## 技术栈

- **TanStack Start** — 全栈 React 框架
- **TanStack Router** — 类型安全的文件路由
- **Tailwind CSS** — 样式
- **TypeScript** — 类型安全

## 支持的存储方案

- XSKY XEOS — 对象存储
- GPFS ECE（开发中）
- Vastdata（开发中）
- Weka（开发中）

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
│   ├── lib/             # 核心计算逻辑
│   │   ├── utils.ts     # 容量/带宽解析工具
│   │   └── xeos.ts      # XEOS 规划器
│   ├── routes/          # 路由页面
│   │   ├── __root.tsx   # 根布局
│   │   └── index.tsx    # 首页（规划表单）
│   ├── router.tsx       # 路由配置
│   └── styles.css       # 全局样式
├── dist/                # 构建输出
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 部署

### Cloudflare Workers

#### 分支部署策略

- **功能分支** → 自动部署到预览环境（`storplan-<branch-name>.workers.dev`）
- **PR 合并到 main** → 自动部署到生产环境（`storplan.workers.dev`）
- **分支删除/PR 关闭** → 自动清理预览 Worker

#### GitHub Actions 自动部署

需要在仓库 Settings > Secrets 中配置：
- `CLOUDFLARE_API_TOKEN` — Cloudflare API Token（需 Workers 编辑权限）
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare Account ID

工作流：
1. 创建功能分支 → 推送代码 → 自动部署预览 Worker
2. 创建 PR → 在 PR 评论中查看预览链接
3. 合并到 main → 自动部署到生产环境
4. PR 关闭或分支删除 → 自动清理预览 Worker

#### 手动部署

```bash
# 部署到生产环境
npm run deploy

# 部署到指定分支预览
npx wrangler deploy --name storplan-feature-branch
```
