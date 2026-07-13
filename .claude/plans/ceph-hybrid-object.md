# 新增 Ceph 混闪对象存储规划

## 目标
1. 新增存储方案「Ceph 混闪（对象存储）」，仅建议配置为 Ceph RGW。
2. 原有 Ceph 改标记为「Ceph（全闪统一存储）」。
3. 混闪硬件规划借鉴 XSKY XEOS 单集群（< 20000 HDD）方案。

## 已确认的决策
- 冗余策略与容量公式沿用现有 Ceph 规则：3 节点→3 副本，4-5→EC2+2，6-7→EC4+2，8-9→EC6+2，10+→EC8+2；容量 = (节点数−1) × 得盘率 × 单节点盘数 × 单盘容量 × 0.909 × 0.7。
- RGW 每 HDD 性能（用户给定）：读 60 MB/s、写 30 MB/s、读 OPS 285、写 OPS 50（内部按 MiB/s 存储，即 60/1.024、30/1.024，与 XEOS 一致的换算方式）。
- 单集群架构，集群 HDD 总数上限 20000，不做 XEOS 两级元数据架构。

## 改动

### 1. 新文件 `src/lib/ceph-hybrid.ts`
- 复用 `ceph.ts` 导出的冗余相关函数（`getRedundancyScheme` / `getAllowedRedundancySchemes` / `REDUNDANCY_SCHEMES`）与容量公式（(n−1)×eff×disks×size×0.909×0.7）。
- 常量（借鉴 XEOS）：
  - `DISKS_PER_NODE_OPTIONS: [24, 26, 28, 30, 32, 34, 36]`，默认 32
  - `DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8]`（TB HDD）
  - `MAX_TOTAL_DISKS: 20000`（单集群上限）
  - 缓存盘：`CACHE_DISK_SIZES: [1.6, 3.2, 6.4, 12.8]`、1–4 块、容量比 1/80（复用 XEOS `calculateCacheConfig` 逻辑，本文件内实现同等函数）
- RGW 每盘性能常量：`READ_BW_PER_DISK: 60/1.024`、`WRITE_BW_PER_DISK: 30/1.024`、`READ_OPS_PER_DISK: 285`、`WRITE_OPS_PER_DISK: 50`
- `CephHybridPlanResult`：节点数、每节点盘数、盘容量、冗余、缓存配置、可用/裸容量、RGW 性能（读/写 BW、读/写 OPS）+ formatted。
- `buildCephHybridResult(...)` 与 `planCephHybrid({capacity, readBandwidth?, writeBandwidth?})`：自动规划逻辑仿照 `planCeph`（枚举盘容量 × 节点数，取最少节点、容量最贴近），并校验 HDD 总数 ≤ 20000，超出抛错。

### 2. `src/routes/index.tsx`
- `STORAGE_ORDER` 增加 `'ceph-hybrid'`（排在 ceph 之后）。
- `THEME` 新增 ceph-hybrid（沿用 Ceph 红色系，label：`Ceph 混闪（对象存储）`）；原 ceph label 改为 `Ceph（全闪统一存储）`。
- `STORAGE_INFO`：
  - ceph（全闪统一存储）：description 改为“…开源分布式统一存储系统，本方案为全闪配置，单一集群同时提供块、对象和文件存储服务”，pros/cons 保持现有。
  - ceph-hybrid：description：“Ceph 混闪配置基于大量 HDD 和少量 NVMe SSD 构建，混闪下仅建议配置为对象存储 Ceph RGW，适合海量非结构化数据低成本存储。”
    - pros：开源软件无需授权、支持多租户、硬件成本低（大容量 HDD）、支持同一集群使用不同容量磁盘
    - cons（移除块/文件相关，保留通用 + 对象相关）：不支持折叠纠删码起步节点少时得盘率低、每盘容量均衡度低可用容量按 70% 计算、Ceph RGW 的 QoS 较弱、无技术支持
    - limits：混闪配置仅建议用作对象存储（RGW），不建议配置块存储和文件系统
- 规划流程：`selectedStorages.has('ceph-hybrid')` 分支 + `manualConfig['ceph-hybrid']`（nodeCount / disksPerNode / diskSize / redundancy / cacheCount / cacheSizePerDisk）+ 对应 handlers（节点数、每节点盘数、盘容量、冗余、缓存盘数/容量，均仿照现有 Ceph/XEOS handlers，联动容量输入框）。
- 新组件 `CephHybridResult`：
  - 集群配置：节点数（min 3）、冗余策略下拉、得盘率、容错、HDD 总数 / 20000 上限（超出红字警告）
  - 容量：可用/裸容量、综合得盘率
  - 每台节点配置（借鉴 XEOS 混闪节点）：2 × Intel Xeon 4134、8 × 32GB DDR4（256GB）、系统盘 2 × 960GB SATA SSD RAID1、数据盘（盘数 × 容量 HDD 下拉）、索引缓存盘（数量 × 容量 NVMe SSD DWPD≥3，含 ≥1/80 校验提示）、网卡 2 × 双口 25Gb ETH
  - 性能（RGW 对象存储预测数据）：读/写 BW、每 TiB 读 BW、读/写 OPS
  - 底部公式说明（容量公式 + 每盘性能数值）

### 3. 验证
- `bun run build`（或 vite build）通过、无 TS 错误。
