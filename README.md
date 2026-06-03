# Storplan

存储容量和性能规划工具。支持多种存储方案的容量、性能计算和方案对比。

## 架构

TypeScript monorepo + Cloudflare 部署：

- **@storplan/core** — 规划计算引擎（共享库）
- **@storplan/api** — Cloudflare Workers REST API
- **@storplan/web** — Cloudflare Pages 前端（Vite + React + Tailwind + shadcn/ui）

## 支持的存储方案

- XSKY XEOS — 对象存储
- GPFS ECE（开发中）
- Vastdata（开发中）
- Weka（开发中）

## 快速开始

```bash
# 安装依赖
npm install

# 构建 core 库
npm run build --workspace=packages/core

# 启动前端开发服务器
npm run dev

# 启动 API 开发服务器
npm run dev:api
```

## 部署

### API (Cloudflare Workers)

```bash
cd packages/api
npx wrangler deploy
```

### 前端 (Cloudflare Pages)

```bash
cd packages/web
npm run build
npx wrangler pages deploy dist
```

## 项目结构

```
storplan/
├── packages/
│   ├── core/        # 规划计算引擎
│   │   └── src/
│   │       ├── index.ts   # 导出入口
│   │       ├── utils.ts   # 容量/带宽解析工具
│   │       └── xeos.ts    # XEOS 规划器
│   ├── api/         # Cloudflare Workers API
│   │   └── src/
│   │       └── index.ts   # Worker 入口
│   └── web/         # React 前端
│       └── src/
│           ├── App.tsx    # 主组件
│           └── main.tsx   # 入口
└── package.json     # Workspace 根配置
```
