# Storplan Kubernetes 部署指南

## 环境信息

- **Kubernetes 集群**：https://219.146.211.38:6443
- **Harbor Registry**：cr.dev1.bz1.paratera.com
- **Kubernetes 版本**：v1.32.5

## 部署方式

### 方式 1：在有 Docker 的节点上构建并推送

如果你的工作环境有 Docker 可用，执行以下步骤：

```bash
cd ~/Projects/wutz/storplan

# 登录 Harbor
docker login cr.dev1.bz1.paratera.com

# 构建并推送后端镜像
docker build -t cr.dev1.bz1.paratera.com/library/storplan-backend:latest -f Dockerfile.backend .
docker push cr.dev1.bz1.paratera.com/library/storplan-backend:latest

# 构建并推送前端镜像
docker build -t cr.dev1.bz1.paratera.com/library/storplan-frontend:latest -f Dockerfile.frontend .
docker push cr.dev1.bz1.paratera.com/library/storplan-frontend:latest

# 部署到 Kubernetes
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml

# 查看部署状态
kubectl get pods -l app=storplan
kubectl get svc -l app=storplan
```

### 方式 2：在 K8s 节点上构建

SSH 到任一 K8s 节点（如 `gn-10-243-145-103`），然后：

```bash
# 克隆或复制项目代码
cd /tmp
# 将代码传输到节点（scp/rsync/git clone）

# 使用 nerdctl 或 ctr 构建
nerdctl build -t cr.dev1.bz1.paratera.com/library/storplan-backend:latest -f Dockerfile.backend .
nerdctl push cr.dev1.bz1.paratera.com/library/storplan-backend:latest

nerdctl build -t cr.dev1.bz1.paratera.com/library/storplan-frontend:latest -f Dockerfile.frontend .
nerdctl push cr.dev1.bz1.paratera.com/library/storplan-frontend:latest

# 回到本地部署
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
```

### 方式 3：使用 Kaniko 在集群内构建（推荐）

创建构建 Job 在集群内构建镜像（无需本地 Docker）：

```bash
cd ~/Projects/wutz/storplan

# 创建构建上下文 ConfigMap
kubectl create configmap storplan-build-context \
  --from-file=Dockerfile.backend \
  --from-file=Dockerfile.frontend \
  --from-file=go.mod \
  --from-file=go.sum \
  --from-file=cmd/ \
  --from-file=internal/ \
  --from-file=web/ \
  --from-file=k8s/nginx.conf

# 应用 Kaniko 构建 Job（需要先创建 k8s/kaniko-build.yaml）
kubectl apply -f k8s/kaniko-build.yaml

# 等待构建完成
kubectl wait --for=condition=complete --timeout=600s job/storplan-build-backend
kubectl wait --for=condition=complete --timeout=600s job/storplan-build-frontend

# 部署应用
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml
```

## 部署清单说明

### backend.yaml
- **Deployment**：2 副本，每个容器 100m CPU / 128Mi 内存请求
- **Service**：ClusterIP 类型，端口 8080
- **健康检查**：`/api/health` 端点

### frontend.yaml
- **Deployment**：2 副本，每个容器 50m CPU / 64Mi 内存请求
- **Service**：LoadBalancer 类型，端口 80
- **Nginx 配置**：
  - 静态文件服务
  - `/api` 反向代理到 backend service
  - Gzip 压缩

## 访问应用

部署完成后：

```bash
# 获取前端 LoadBalancer IP
kubectl get svc storplan-frontend

# 如果是 LoadBalancer 类型，使用 EXTERNAL-IP 访问
# 如果是 ClusterIP/NodePort，可以通过 port-forward 访问
kubectl port-forward svc/storplan-frontend 8080:80

# 浏览器访问 http://localhost:8080
```

## 验证部署

```bash
# 检查 Pod 状态
kubectl get pods -l app=storplan -o wide

# 查看 Pod 日志
kubectl logs -l app=storplan,component=backend
kubectl logs -l app=storplan,component=frontend

# 测试后端 API
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl http://storplan-backend:8080/api/health

# 测试完整流程（从前端到后端）
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -- \
  curl -X POST http://storplan-backend:8080/api/plan \
  -H "Content-Type: application/json" \
  -d '{"storage":"xeos","capacity":"500TiB"}'
```

## 故障排查

### Pod 无法启动

```bash
kubectl describe pod -l app=storplan
kubectl logs <pod-name>
```

### 镜像拉取失败

检查 Harbor 认证：

```bash
# 创建 Harbor pull secret（如果需要）
kubectl create secret docker-registry harbor-cred \
  --docker-server=cr.dev1.bz1.paratera.com \
  --docker-username=<username> \
  --docker-password=<password>

# 在 Deployment 中使用
# spec.template.spec.imagePullSecrets:
# - name: harbor-cred
```

### 前端无法访问后端

检查 Service 和 DNS：

```bash
kubectl get svc storplan-backend
kubectl run -it --rm debug --image=busybox --restart=Never -- nslookup storplan-backend
```

## 更新应用

```bash
# 重新构建并推送镜像（版本号）
docker build -t cr.dev1.bz1.paratera.com/library/storplan-backend:v1.1.0 -f Dockerfile.backend .
docker push cr.dev1.bz1.paratera.com/library/storplan-backend:v1.1.0

# 更新 Deployment 镜像
kubectl set image deployment/storplan-backend backend=cr.dev1.bz1.paratera.com/library/storplan-backend:v1.1.0
kubectl set image deployment/storplan-frontend frontend=cr.dev1.bz1.paratera.com/library/storplan-frontend:v1.1.0

# 或滚动重启（使用 :latest 标签时）
kubectl rollout restart deployment/storplan-backend
kubectl rollout restart deployment/storplan-frontend
```

## 清理资源

```bash
kubectl delete -f k8s/backend.yaml
kubectl delete -f k8s/frontend.yaml
kubectl delete configmap storplan-build-context
```
