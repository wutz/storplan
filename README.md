# Storplan

存储容量和性能规划工具，支持多种存储方案的容量、性能计算和方案对比。

## 架构

- **Backend（Go）**：规划计算引擎 + REST API 服务
- **CLI（Go）**：命令行工具，可独立使用或调用后端服务
- **Frontend（React + shadcn/ui）**：Web 界面

## 支持的存储方案

- GPFS ECE — 高性能文件系统
- XSKY XEOS — 对象存储
- Vastdata — 统一存储平台（文件/对象/块）
- Weka — 高性能文件系统
- Ceph RGW — 对象存储（开发中）

## 快速开始

### 后端开发

```bash
# 安装依赖
go mod download

# 启动 API 服务器
go run cmd/server/main.go

# 构建 CLI
go build -o storplan cmd/storplan/main.go

# 使用 CLI
./storplan plan --storage xeos --capacity 500TiB
```

### 前端开发

```bash
cd web

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 项目结构

```
.
├── cmd/
│   ├── server/      # API 服务器入口
│   └── storplan/    # CLI 入口
├── internal/
│   ├── planner/     # 规划计算引擎（核心逻辑）
│   └── api/         # REST API 实现
└── web/             # 前端应用（React + shadcn/ui）
```

## 开发计划

- [x] 项目初始化
- [ ] 实现 GPFS ECE 规划器
- [ ] 实现 XSKY XEOS 规划器
- [ ] 实现 Vastdata 规划器
- [ ] 实现 Weka 规划器
- [ ] CLI 基本命令
- [ ] REST API 服务
- [ ] Web 前端界面
- [ ] 方案对比功能
