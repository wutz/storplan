#!/bin/bash
set -e

# Storplan K8s 部署脚本
# 在 K8s 节点上构建镜像并部署

REGISTRY="cr.dev1.bz1.paratera.com/library"
VERSION="${VERSION:-latest}"
BUILD_NODE="${BUILD_NODE:-gn-10-243-145-103}"

echo "=== Storplan K8s 部署 ==="
echo "Registry: $REGISTRY"
echo "Version: $VERSION"
echo "Build Node: $BUILD_NODE"
echo ""

# 1. 打包代码
echo "[1/5] 打包项目代码..."
cd "$(dirname "$0")/.."
tar czf /tmp/storplan-build.tar.gz \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='web/node_modules' \
  --exclude='web/dist' \
  --exclude='*.exe' \
  --exclude='server' \
  --exclude='storplan' \
  .

# 2. 传输到构建节点
echo "[2/5] 传输代码到构建节点 $BUILD_NODE..."
scp /tmp/storplan-build.tar.gz "$BUILD_NODE:/tmp/"

# 3. 在节点上构建镜像
echo "[3/5] 在节点上构建 Docker 镜像..."
ssh "$BUILD_NODE" bash <<'REMOTE_SCRIPT'
set -e
cd /tmp
rm -rf storplan-build
mkdir storplan-build
cd storplan-build
tar xzf ../storplan-build.tar.gz

# 使用 nerdctl 构建（K8s 节点通常有 nerdctl）
echo "构建后端镜像..."
nerdctl build -t cr.dev1.bz1.paratera.com/library/storplan-backend:latest \
  -f Dockerfile.backend .

echo "构建前端镜像..."
nerdctl build -t cr.dev1.bz1.paratera.com/library/storplan-frontend:latest \
  -f Dockerfile.frontend .

echo "推送镜像到 Harbor..."
nerdctl push cr.dev1.bz1.paratera.com/library/storplan-backend:latest
nerdctl push cr.dev1.bz1.paratera.com/library/storplan-frontend:latest

echo "清理构建目录..."
cd /tmp
rm -rf storplan-build storplan-build.tar.gz
REMOTE_SCRIPT

# 4. 更新 K8s 清单中的镜像地址
echo "[4/5] 更新 Kubernetes 清单..."
sed -i.bak "s|image: storplan-backend:latest|image: $REGISTRY/storplan-backend:$VERSION|g" k8s/backend.yaml
sed -i.bak "s|image: storplan-frontend:latest|image: $REGISTRY/storplan-frontend:$VERSION|g" k8s/frontend.yaml

# 5. 部署到 K8s
echo "[5/5] 部署到 Kubernetes..."
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml

# 恢复原始清单
mv k8s/backend.yaml.bak k8s/backend.yaml
mv k8s/frontend.yaml.bak k8s/frontend.yaml

echo ""
echo "=== 部署完成 ==="
echo "查看部署状态："
echo "  kubectl get pods -l app=storplan"
echo "  kubectl get svc -l app=storplan"
echo ""
echo "查看日志："
echo "  kubectl logs -l app=storplan,component=backend"
echo "  kubectl logs -l app=storplan,component=frontend"
echo ""
echo "访问应用："
echo "  kubectl get svc storplan-frontend  # 查看 LoadBalancer IP"
