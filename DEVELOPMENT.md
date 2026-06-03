# Storplan 开发和部署指南

## 项目结构

```
storplan/
├── cmd/
│   ├── server/         # REST API 服务器
│   └── storplan/       # CLI 命令行工具
├── internal/
│   ├── planner/        # 规划计算引擎
│   │   ├── types.go    # 数据类型定义
│   │   ├── utils.go    # 工具函数（容量/带宽解析和格式化）
│   │   └── xeos.go     # XSKY XEOS 规划器实现
│   └── api/            # REST API 实现
│       └── router.go   # 路由和处理器
└── web/                # 前端应用
    ├── src/
    │   ├── App.tsx     # 主应用组件
    │   ├── main.tsx    # React 入口
    │   ├── index.css   # 全局样式（Tailwind）
    │   └── lib/
    │       └── utils.ts # 前端工具函数
    └── vite.config.ts  # Vite 配置（含 API 代理）
```

## 后端开发

### 安装依赖

```bash
go mod download
```

### 启动 API 服务器

```bash
go run cmd/server/main.go
# 服务器运行在 http://localhost:8080
```

### 构建和使用 CLI

```bash
# 构建
go build -o storplan cmd/storplan/main.go

# 使用示例
./storplan plan --storage xeos --capacity 500TiB
./storplan plan --storage xeos --capacity 2PB --write-bw 10Gbps --read-bw 20Gbps
./storplan plan --storage xeos --capacity 1PiB --write-iops 50000 --json
```

CLI 参数：
- `--storage`: 存储类型（目前仅支持 `xeos`）
- `--capacity`: 容量需求（如 `500TiB`, `2PB`）
- `--read-bw`: 读带宽需求（如 `20Gbps`, `2GiB/s`）
- `--write-bw`: 写带宽需求（如 `10Gbps`, `1GiB/s`）
- `--read-iops`: 读 IOPS 需求
- `--write-iops`: 写 IOPS 需求
- `--json`: JSON 格式输出

### 添加新的存储规划器

1. 在 `internal/planner/` 下创建新文件（如 `gpfs.go`）
2. 实现 `Planner` 接口：

```go
type MyPlanner struct{}

func (p *MyPlanner) Name() string {
    return "My Storage"
}

func (p *MyPlanner) Plan(req PlanRequest) (*StoragePlan, error) {
    // 实现规划逻辑
    return &StoragePlan{...}, nil
}
```

3. 在 `internal/api/router.go` 和 `cmd/storplan/main.go` 中注册新规划器

## 前端开发

### 安装依赖

```bash
cd web
npm install
```

### 启动开发服务器

```bash
npm run dev
# 前端运行在 http://localhost:3000
# API 请求会自动代理到 http://localhost:8080
```

**重要**：前端开发时需要同时启动后端服务器（`go run cmd/server/main.go`）

### 构建生产版本

```bash
npm run build
# 输出到 web/dist/
```

### 技术栈

- **React 19** + TypeScript
- **Vite 8** - 构建工具
- **Tailwind CSS 4** - 样式框架
- **React Router 7** - 路由（预留）
- **shadcn/ui** 基础设施（class-variance-authority, clsx, tailwind-merge）

## 部署

### 后端部署

#### 方式 1：直接运行

```bash
# 构建
go build -o storplan-server cmd/server/main.go

# 运行
PORT=8080 ./storplan-server
```

#### 方式 2：Docker

```dockerfile
FROM golang:1.23 AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o server cmd/server/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
CMD ["./server"]
```

### 前端部署

#### 方式 1：静态托管

```bash
cd web
npm run build
# 将 dist/ 部署到 Nginx/Caddy/Vercel 等
```

Nginx 配置示例：

```nginx
server {
    listen 80;
    root /var/www/storplan/web/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

#### 方式 2：Node.js 服务器

使用 `vite preview` 或 `serve` 包：

```bash
npm install -g serve
serve -s dist -l 3000
```

### Kubernetes 部署

查看 `k8s/` 目录（待添加）的部署清单示例。

## API 文档

### `POST /api/plan`

规划存储配置。

**请求体：**

```json
{
  "storage": "xeos",
  "capacity": "500TiB",
  "performance": {
    "readBandwidth": "20Gbps",
    "writeBandwidth": "10Gbps",
    "readIOPS": 30000,
    "writeIOPS": 10000
  }
}
```

**响应：**

```json
{
  "solution": "XSKY XEOS",
  "serverCount": 3,
  "capacity": {
    "usableCapacity": 565.5,
    "unit": "TiB"
  },
  "performance": {
    "readBandwidth": 48.32,
    "writeBandwidth": 24.16,
    "readIOPS": 28800,
    "writeIOPS": 9600,
    "bandwidthUnit": "Gbps"
  },
  "configuration": {
    "ecScheme": "EC4+2:1",
    "tolerance": "1 node(s)",
    "diskSize": "12TB",
    "diskCount": "32 per server"
  }
}
```

## 故障排查

### 前端无法连接后端

1. 检查后端是否运行：`curl http://localhost:8080/api/health`
2. 检查 Vite 代理配置：`web/vite.config.ts` 中的 `proxy` 设置
3. 检查浏览器控制台的网络请求

### CLI 报错 "unsupported storage type"

当前仅支持 `xeos`，其他规划器正在开发中。

### Go 依赖问题

```bash
go mod tidy
go mod download
```

### 前端依赖问题

```bash
cd web
rm -rf node_modules bun.lock
npm install
```

## 下一步开发计划

- [ ] 实现 GPFS ECE 规划器
- [ ] 实现 Vastdata 规划器
- [ ] 实现 Weka 规划器
- [ ] 添加方案对比功能
- [ ] 添加可视化图表（Recharts）
- [ ] 添加单元测试
- [ ] 添加 Docker Compose 一键启动
- [ ] 添加 Kubernetes 部署清单
