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
- **GPFS ECE** — 高性能文件系统

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

通过 `wrangler` CLI 手动部署：

```bash
npm run deploy
```
