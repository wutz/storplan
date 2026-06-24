import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

export interface XEOSPlanRequest {
  capacity: string;
  uploadBandwidth?: string;
  downloadBandwidth?: string;
  uploadOps?: number;
  downloadOps?: number;
}

export interface CacheConfig {
  count: number;
  sizePerDisk: number;
  totalSize: number;
}

export interface PoolConfig {
  poolCount: number;
  serversPerPool: number[];
  totalTolerance: number;
}

// 一级全闪元数据集群（超大规模架构）
export interface MetadataClusterConfig {
  nodeCount: number;
  disksPerNode: number; // METADATA_DISK_COUNTS 之一
  diskSize: number; // NVMe 单盘容量（TB）
  totalSize: number; // 裸 NVMe 总容量（TB）= nodeCount × disksPerNode × diskSize
  ecScheme: string;
  tolerance: number;
}

// 超大规模两级架构配置
export interface UltraLargeConfig {
  tier2ClusterCount: number; // 二级数据集群数
  nodesPerCluster: number; // 标准每簇节点数（40）
  lastClusterNodes: number; // 最后一簇实际节点数（10–40，等于 40 时各簇均满）
  tier2ServersTotal: number; // 二级总节点数 = (clusterCount-1) × 40 + lastClusterNodes
  tier2TotalHDDs: number; // 二级集群 HDD 总数
  tier2PerClusterCapacity: number; // 满簇（40 节点）可用容量（TiB）
  tier2CacheSSDTotal: number; // 全部二级节点缓存盘裸容量之和（TB）
  tier2PerClusterTolerance: number; // 满簇容忍离线节点数（40 节点 → 2 池 × 2 = 4）
  metadataCluster: MetadataClusterConfig; // 一级元数据集群
  ratio: number; // 实际 二级SSD总 / 一级NVMe总（目标 5）
}

export interface XEOSPlanResult {
  serverCount: number;
  disksPerServer: number;
  ecScheme: string;
  tolerance: number;
  diskSize: number;
  actualCapacity: number;
  rawCapacity: number;
  cacheConfig: CacheConfig;
  poolConfig?: PoolConfig;
  performance: {
    uploadBandwidth: number;
    downloadBandwidth: number;
    uploadOps: number;
    downloadOps: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    uploadBandwidth: string;
    downloadBandwidth: string;
    uploadOps: string;
    downloadOps: string;
  };
  capacityUnitPreference: boolean;
  bandwidthUnitType: string;
  ultraLarge?: UltraLargeConfig;
}

export const CONSTANTS = {
  DISKS_PER_SERVER_OPTIONS: [24, 26, 28, 30, 32, 34, 36] as const,
  MAX_TOTAL_DISKS: 2000,
  MAX_SERVERS: 4096,
  SPACE_OVERHEAD: 0.81,
  EC8_2_EFFICIENCY: 0.8,
  EC4_2_EFFICIENCY: 0.6667,
  // 厂商性能数据。吞吐以 MiB/s 为内部规范单位（输入解析/格式化均按 MiB/s），
  // 故 70 MB/s = 70/1.024 MiB/s，显示时 formatBandwidth 会还原为 HDD 盘数 × 70 MB/s
  READ_BW_PER_DISK: 70 / 1.024,
  WRITE_BW_PER_DISK: 46 / 1.024,
  READ_OPS_PER_DISK: 333,
  WRITE_OPS_PER_DISK: 83,
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8] as const,
  TB_TO_TIB: 0.909,
  CACHE_DISK_SIZES: [1.6, 3.2, 6.4, 12.8] as const,
  MAX_CACHE_DISKS: 4,
  MIN_CACHE_DISKS: 1,
  CACHE_RATIO: 80,
  // 超大规模集群（2000–20000 HDD）两级架构
  MAX_TOTAL_DISKS_ULTRA: 20000,
  ULTRA_NODES_PER_CLUSTER: 40, // 二级数据集群每簇标准节点数（最后一簇可少于 40）
  ULTRA_MIN_LAST_CLUSTER_NODES: 10, // 最后一簇最小节点数（EC8+2 最低要求）
  ULTRA_DEFAULT_DISKS_PER_SERVER: 32, // 二级数据集群每节点缺省数据盘数
  METADATA_DISK_COUNTS: [2, 4] as const, // 一级元数据节点每节点 NVMe 数
  METADATA_DISK_SIZES: [1.6, 3.2, 6.4, 12.8] as const, // 一级元数据 NVMe 单盘容量（TB，DWPD ≥ 3）
  METADATA_TIER_RATIO: 5, // 二级 SSD 总容量 / 一级 NVMe 总容量 = 5（决定元数据 NVMe 总量）
  MIN_METADATA_NODES: 6, // 元数据集群最小 6 台（6–9 用 EC4+2）
  MAX_METADATA_NODES: 20, // 元数据集群最大 20 台（≥10 用 EC8+2）
};

export const EC_SCHEMES = [
  { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1, minServers: 3 },
  { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1, minServers: 5 },
  { scheme: 'EC4+2', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 2, minServers: 6 },
  { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2, minServers: 10 },
] as const;

export function calculateCacheConfig(disksPerServer: number, diskSizeTB: number): CacheConfig {
  const requiredCacheTB = (disksPerServer * diskSizeTB) / CONSTANTS.CACHE_RATIO;

  // 遍历所有 (盘数 × 容量) 组合，选总容量最接近需求（浪费最小）的；
  // 同等接近时优先更多盘数
  let bestCount = CONSTANTS.MAX_CACHE_DISKS;
  let bestSize = CONSTANTS.CACHE_DISK_SIZES[CONSTANTS.CACHE_DISK_SIZES.length - 1];
  let bestWaste = Infinity;

  for (let count = CONSTANTS.MIN_CACHE_DISKS; count <= CONSTANTS.MAX_CACHE_DISKS; count++) {
    for (const sizePerDisk of CONSTANTS.CACHE_DISK_SIZES) {
      const totalSize = count * sizePerDisk;
      if (totalSize >= requiredCacheTB) {
        const waste = totalSize - requiredCacheTB;
        if (waste < bestWaste || (waste === bestWaste && count > bestCount)) {
          bestWaste = waste;
          bestCount = count;
          bestSize = sizePerDisk;
        }
      }
    }
  }

  return { count: bestCount, sizePerDisk: bestSize, totalSize: bestCount * bestSize };
}

export function calculatePoolConfig(serverCount: number, ecScheme: string): PoolConfig | undefined {
  if (ecScheme !== 'EC8+2' || serverCount < 20) {
    return undefined;
  }

  // 每 20 台分一个池，每个池至少 10 台使用 EC8+2
  // 例：32 台 → 20+12（2 池，容忍 4 台）；24 台 → 不分池（余 4 < 10，合并为 1 池）
  const fullPools = Math.floor(serverCount / 20);
  const remainder = serverCount % 20;

  if (remainder >= 10) {
    // 剩余台数 >= 10，单独成池
    const serversPerPool = Array(fullPools).fill(20);
    serversPerPool.push(remainder);
    const poolCount = fullPools + 1;
    return {
      poolCount,
      serversPerPool,
      totalTolerance: poolCount * 2,
    };
  } else if (remainder > 0) {
    // 剩余台数 < 10，无法独立成池，合并到最后一个池（等效不分池）
    const serversPerPool = Array(fullPools - 1).fill(20);
    serversPerPool.push(20 + remainder);
    const poolCount = fullPools;
    return {
      poolCount,
      serversPerPool,
      totalTolerance: poolCount * 2,
    };
  } else {
    // 正好整除
    const poolCount = fullPools;
    return {
      poolCount,
      serversPerPool: Array(poolCount).fill(20),
      totalTolerance: poolCount * 2,
    };
  }
}

export function getAllowedEcSchemes(serverCount: number): typeof EC_SCHEMES[number][] {
  if (serverCount <= 4) {
    return [EC_SCHEMES[0]]; // EC4+2:1
  }
  if (serverCount <= 9) {
    return [EC_SCHEMES[1], EC_SCHEMES[2]]; // EC8+2:1, EC4+2
  }
  // 10 台及以上只允许 EC8+2
  return [EC_SCHEMES[3]]; // EC8+2
}

export function calculateCapacityTiB(serverCount: number, disksPerServer: number, diskSizeTB: number, ecEfficiency: number): number {
  return serverCount * disksPerServer * diskSizeTB * CONSTANTS.TB_TO_TIB * CONSTANTS.SPACE_OVERHEAD * ecEfficiency;
}

interface ECScheme {
  scheme: string;
  efficiency: number;
  tolerance: number;
}

export function getEcScheme(serverCount: number): ECScheme {
  if (serverCount <= 4) return { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1 };
  if (serverCount <= 9) return { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1 };
  return { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2 };
}

function calculateActualCapacity(serverCount: number, disksPerServer: number, diskSizeTB: number, efficiency: number): number {
  const diskSizeTiB = diskSizeTB * CONSTANTS.TB_TO_TIB;
  return serverCount * disksPerServer * diskSizeTiB * CONSTANTS.SPACE_OVERHEAD * efficiency;
}

function calculateRawCapacity(serverCount: number, disksPerServer: number, diskSizeTB: number): number {
  return serverCount * disksPerServer * diskSizeTB * CONSTANTS.TB_TO_TIB;
}

function calculatePerformance(totalDisks: number) {
  return {
    uploadBandwidth: totalDisks * CONSTANTS.WRITE_BW_PER_DISK,
    downloadBandwidth: totalDisks * CONSTANTS.READ_BW_PER_DISK,
    uploadOps: totalDisks * CONSTANTS.WRITE_OPS_PER_DISK,
    downloadOps: totalDisks * CONSTANTS.READ_OPS_PER_DISK,
  };
}

function calculateMinServersForPerf(perfReq: { uploadBw?: number; downloadBw?: number; uploadOps?: number; downloadOps?: number }, disksPerServer: number): number {
  const needs = [
    perfReq.uploadBw ? perfReq.uploadBw / CONSTANTS.WRITE_BW_PER_DISK : 0,
    perfReq.downloadBw ? perfReq.downloadBw / CONSTANTS.READ_BW_PER_DISK : 0,
    perfReq.uploadOps ? perfReq.uploadOps / CONSTANTS.WRITE_OPS_PER_DISK : 0,
    perfReq.downloadOps ? perfReq.downloadOps / CONSTANTS.READ_OPS_PER_DISK : 0,
  ];
  const maxDisks = Math.max(...needs);
  if (maxDisks === 0) return 0;
  return Math.ceil(maxDisks / disksPerServer);
}

function scoreConfig(serverCount: number, ecEfficiency: number, actualCapacity: number, requiredCapacity: number): number {
  const overProvisionRatio = actualCapacity / requiredCapacity;
  return serverCount * 1000 + (1 - ecEfficiency) * 100 + overProvisionRatio;
}

export function buildXEOSResult(
  serverCount: number,
  disksPerServer: number,
  diskSize: number,
  ecScheme: string,
  ecEfficiency: number,
  tolerance: number,
  isBinary: boolean,
  bandwidthUnitType: string
): XEOSPlanResult {
  const actualCapacity = calculateActualCapacity(serverCount, disksPerServer, diskSize, ecEfficiency);
  const rawCapacity = calculateRawCapacity(serverCount, disksPerServer, diskSize);
  const totalDisks = serverCount * disksPerServer;
  const performance = calculatePerformance(totalDisks);
  const cacheConfig = calculateCacheConfig(disksPerServer, diskSize);
  const poolConfig = calculatePoolConfig(serverCount, ecScheme);
  // 分池时容忍离线台数 = 2 × 池数，覆盖传入的基础 tolerance
  const effectiveTolerance = poolConfig ? poolConfig.totalTolerance : tolerance;

  return {
    serverCount, disksPerServer, ecScheme, tolerance: effectiveTolerance, diskSize, actualCapacity, rawCapacity, cacheConfig, poolConfig, performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      uploadBandwidth: formatBandwidth(performance.uploadBandwidth, bandwidthUnitType),
      downloadBandwidth: formatBandwidth(performance.downloadBandwidth, bandwidthUnitType),
      uploadOps: `${performance.uploadOps.toLocaleString()}`,
      downloadOps: `${performance.downloadOps.toLocaleString()}`,
    },
    capacityUnitPreference: isBinary,
    bandwidthUnitType,
  };
}

// ===== 超大规模集群（2000–20000 HDD）两级架构 =====

interface Tier2Config {
  disksPerServer: number;
  diskSize: number;
  numClusters: number;
  lastClusterNodes: number; // 最后一簇节点数（10–40）
  totalNodes: number;
  totalHDDs: number;
  perClusterCapacity: number; // 满簇（40 节点）可用容量（TiB）
  actualCapacity: number; // 全部二级集群可用容量之和（TiB）
}

// 将总节点数拆为若干 40 节点集群，最后一簇可少于 40（但不少于 EC8+2 最低要求 10 台）。
// 每簇 ≤ 40，末簇 ∈ [10, 40]；若余数为 1–9，则上调末簇至 10 台（其余簇仍各 40）。
// 返回 { numClusters, lastClusterNodes }（lastClusterNodes 已是上调后的实际值）。
function splitClusters(totalNodes: number): { numClusters: number; lastClusterNodes: number } {
  const full = CONSTANTS.ULTRA_NODES_PER_CLUSTER;
  const minLast = CONSTANTS.ULTRA_MIN_LAST_CLUSTER_NODES;
  if (totalNodes <= full) {
    return { numClusters: 1, lastClusterNodes: Math.max(totalNodes, 0) };
  }
  const numClusters = Math.ceil(totalNodes / full);
  let lastClusterNodes = totalNodes - (numClusters - 1) * full; // ∈ [1, 40]
  // 末簇不足 10 台时上调至 10，保证 EC8+2 可成立（每簇仍 ≤ 40）
  if (lastClusterNodes < minLast) lastClusterNodes = minLast;
  return { numClusters, lastClusterNodes };
}

// 规划二级数据集群：每节点缺省 32 块数据盘，每簇 40 节点（EC8+2），最后一簇允许少于 40 台以减少超配；
// HDD 总数 ≤ 20000。节点数按满簇单节点可用容量向上取整，再拆簇。评分：主指标总 HDD 数，次指标总节点数。
export function planTier2(capacityTiB: number): Tier2Config {
  const nodesPerCluster = CONSTANTS.ULTRA_NODES_PER_CLUSTER;
  const disksPerServer = CONSTANTS.ULTRA_DEFAULT_DISKS_PER_SERVER;
  const ecEff = CONSTANTS.EC8_2_EFFICIENCY;
  const candidates: Tier2Config[] = [];

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    const perClusterCapacity = calculateActualCapacity(nodesPerCluster, disksPerServer, diskSize, ecEff);
    const perNodeCapacity = perClusterCapacity / nodesPerCluster;
    // 按单节点可用容量向上取整所需节点数（减去极小 epsilon 抵消浮点误差）
    let totalNodes = Math.max(nodesPerCluster, Math.ceil(capacityTiB / perNodeCapacity - 1e-9));
    const { numClusters, lastClusterNodes } = splitClusters(totalNodes);
    totalNodes = (numClusters - 1) * nodesPerCluster + lastClusterNodes;
    const totalHDDs = totalNodes * disksPerServer;
    if (totalHDDs > CONSTANTS.MAX_TOTAL_DISKS_ULTRA) continue;
    candidates.push({
      disksPerServer,
      diskSize,
      numClusters,
      lastClusterNodes,
      totalNodes,
      totalHDDs,
      perClusterCapacity,
      actualCapacity: calculateActualCapacity(totalNodes, disksPerServer, diskSize, ecEff),
    });
  }

  if (candidates.length === 0) {
    throw new Error('所需容量超过 20000 块 HDD 上限（超大规模集群上限），请联系 XSKY 技术支持');
  }

  return candidates.reduce((a, b) => {
    if (a.totalHDDs !== b.totalHDDs) return a.totalHDDs < b.totalHDDs ? a : b;
    return a.totalNodes <= b.totalNodes ? a : b;
  });
}

// 元数据集群 EC 方案：6–9 台用 EC4+2，≥10 台用 EC8+2（均容忍 2 节点离线）。
function getMetadataEcScheme(nodeCount: number): { scheme: string; tolerance: number } {
  return nodeCount >= 10
    ? { scheme: 'EC8+2', tolerance: 2 }
    : { scheme: 'EC4+2', tolerance: 2 };
}

// 规划一级元数据集群：
// - 所需 NVMe 总量 = 二级缓存 SSD 总量 / 5（容量配比）。
// - 节点数 ∈ [6, 20]、每节点 [2,4]×[1.6,3.2,6.4,12.8]TB，枚举所有组合，
//   取满足 NVMe 总量需求且总容量最小（最小化超配）、其次节点数最小的方案。
// - 6–9 台用 EC4+2，≥10 台用 EC8+2。
export function planMetadata(requiredNvmeTB: number): MetadataClusterConfig {
  let best: MetadataClusterConfig | null = null;

  for (let nodeCount = CONSTANTS.MIN_METADATA_NODES; nodeCount <= CONSTANTS.MAX_METADATA_NODES; nodeCount++) {
    for (const disksPerNode of CONSTANTS.METADATA_DISK_COUNTS) {
      for (const diskSize of CONSTANTS.METADATA_DISK_SIZES) {
        // round2 抵消浮点误差，使裸容量为整洁数值
        const totalSize = Math.round(nodeCount * disksPerNode * diskSize * 100) / 100;
        if (totalSize < requiredNvmeTB - 1e-9) continue;
        const ec = getMetadataEcScheme(nodeCount);
        const cand: MetadataClusterConfig = { nodeCount, disksPerNode, diskSize, totalSize, ecScheme: ec.scheme, tolerance: ec.tolerance };
        if (!best || totalSize < best.totalSize || (totalSize === best.totalSize && nodeCount < best.nodeCount)) {
          best = cand;
        }
      }
    }
  }

  // 需求超过最大配置（20 台 × 4×12.8=51.2TB = 1024TB）时取最大配置兜底
  if (!best) {
    const nodeCount = CONSTANTS.MAX_METADATA_NODES;
    const disksPerNode = CONSTANTS.METADATA_DISK_COUNTS[CONSTANTS.METADATA_DISK_COUNTS.length - 1];
    const diskSize = CONSTANTS.METADATA_DISK_SIZES[CONSTANTS.METADATA_DISK_SIZES.length - 1];
    const totalSize = Math.round(nodeCount * disksPerNode * diskSize * 100) / 100;
    const ec = getMetadataEcScheme(nodeCount);
    best = { nodeCount, disksPerNode, diskSize, totalSize, ecScheme: ec.scheme, tolerance: ec.tolerance };
  }

  return best;
}

// 组装超大规模两级架构结果（顶层为全部署聚合 + 二级节点代表性配置）。
// 由 planTier2（按容量自动）与 buildUltraLargeFromServers（按手动节点数）共用。
function assembleUltraLarge(
  numClusters: number,
  lastClusterNodes: number,
  disksPerServer: number,
  diskSize: number,
  cacheConfig: CacheConfig,
  isBinary: boolean,
  bandwidthUnitType: string
): XEOSPlanResult {
  const nodesPerCluster = CONSTANTS.ULTRA_NODES_PER_CLUSTER;
  const tier2ServersTotal = (numClusters - 1) * nodesPerCluster + lastClusterNodes;
  const tier2TotalHDDs = tier2ServersTotal * disksPerServer;
  if (tier2TotalHDDs > CONSTANTS.MAX_TOTAL_DISKS_ULTRA) {
    throw new Error('所需规模超过 20000 块 HDD 上限（超大规模集群上限），请联系 XSKY 技术支持');
  }

  const ecEff = CONSTANTS.EC8_2_EFFICIENCY;
  const perClusterCapacity = calculateActualCapacity(nodesPerCluster, disksPerServer, diskSize, ecEff);
  const actualCapacity = calculateActualCapacity(tier2ServersTotal, disksPerServer, diskSize, ecEff);
  const rawCapacity = calculateRawCapacity(tier2ServersTotal, disksPerServer, diskSize);
  // round2 抵消浮点误差（如 3×3.2=9.600000000000001）
  const tier2CacheSSDTotal = Math.round(tier2ServersTotal * cacheConfig.totalSize * 100) / 100;
  const requiredNvmeTB = tier2CacheSSDTotal / CONSTANTS.METADATA_TIER_RATIO;
  const metadataCluster = planMetadata(requiredNvmeTB);
  const ratio = tier2CacheSSDTotal / metadataCluster.totalSize;

  // 40 节点 EC8+2 集群 → 2 池 × 2 = 容忍 4 节点离线
  const perClusterPool = calculatePoolConfig(nodesPerCluster, 'EC8+2');
  const tier2PerClusterTolerance = perClusterPool ? perClusterPool.totalTolerance : 2;
  const performance = calculatePerformance(tier2TotalHDDs);

  const ultraLarge: UltraLargeConfig = {
    tier2ClusterCount: numClusters,
    nodesPerCluster,
    lastClusterNodes,
    tier2ServersTotal,
    tier2TotalHDDs,
    tier2PerClusterCapacity: perClusterCapacity,
    tier2CacheSSDTotal,
    tier2PerClusterTolerance,
    metadataCluster,
    ratio,
  };

  return {
    serverCount: tier2ServersTotal,
    disksPerServer,
    ecScheme: 'EC8+2',
    tolerance: tier2PerClusterTolerance,
    diskSize,
    actualCapacity,
    rawCapacity,
    cacheConfig,
    poolConfig: undefined,
    performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      uploadBandwidth: formatBandwidth(performance.uploadBandwidth, bandwidthUnitType),
      downloadBandwidth: formatBandwidth(performance.downloadBandwidth, bandwidthUnitType),
      uploadOps: `${performance.uploadOps.toLocaleString()}`,
      downloadOps: `${performance.downloadOps.toLocaleString()}`,
    },
    capacityUnitPreference: isBinary,
    bandwidthUnitType,
    ultraLarge,
  };
}

export function buildUltraLargeXEOSResult(tier2: Tier2Config, isBinary: boolean, bandwidthUnitType: string): XEOSPlanResult {
  const cacheConfig = calculateCacheConfig(tier2.disksPerServer, tier2.diskSize);
  return assembleUltraLarge(tier2.numClusters, tier2.lastClusterNodes, tier2.disksPerServer, tier2.diskSize, cacheConfig, isBinary, bandwidthUnitType);
}

// 手动节点数入口：用户在 UI 直接指定服务器台数。当 台数 × 每台 HDD > 2000 时，
// 按 40 节点/簇拆分（最后一簇可少于 40），组装超大规模两级架构（含一级元数据集群）。
export function buildUltraLargeFromServers(
  serverCount: number,
  disksPerServer: number,
  diskSize: number,
  cacheCount: number,
  cacheSizePerDisk: number,
  isBinary: boolean,
  bandwidthUnitType: string
): XEOSPlanResult {
  const { numClusters, lastClusterNodes } = splitClusters(serverCount);
  const cacheConfig: CacheConfig = {
    count: cacheCount,
    sizePerDisk: cacheSizePerDisk,
    totalSize: Math.round(cacheCount * cacheSizePerDisk * 100) / 100,
  };
  return assembleUltraLarge(numClusters, lastClusterNodes, disksPerServer, diskSize, cacheConfig, isBinary, bandwidthUnitType);
}

export function planXEOS(req: XEOSPlanRequest): XEOSPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  const perfReq: { uploadBw?: number; downloadBw?: number; uploadOps?: number; downloadOps?: number } = {};
  let bandwidthUnitType: string | null = null;

  if (req.uploadBandwidth) {
    const bwInfo = parseBandwidth(req.uploadBandwidth);
    perfReq.uploadBw = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (req.downloadBandwidth) {
    const bwInfo = parseBandwidth(req.downloadBandwidth);
    perfReq.downloadBw = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (req.uploadOps) perfReq.uploadOps = req.uploadOps;
  if (req.downloadOps) perfReq.downloadOps = req.downloadOps;

  if (bandwidthUnitType === null) bandwidthUnitType = 'decimal-bit';

  interface Config {
    serverCount: number;
    disksPerServer: number;
    diskSize: number;
    ecScheme: string;
    ecEfficiency: number;
    tolerance: number;
    actualCapacity: number;
  }

  const configs: Config[] = [];

  for (const disksPerServer of CONSTANTS.DISKS_PER_SERVER_OPTIONS) {
    const minServersForPerf = calculateMinServersForPerf(perfReq, disksPerServer);
    const startServers = Math.max(3, minServersForPerf);

    for (const diskSize of CONSTANTS.DISK_SIZES) {
      for (let servers = startServers; servers <= CONSTANTS.MAX_SERVERS; servers++) {
        const totalDisks = servers * disksPerServer;

        // 检查集群 HDD 总数上限
        if (totalDisks > CONSTANTS.MAX_TOTAL_DISKS) {
          break;
        }

        const ec = getEcScheme(servers);
        const actual = calculateActualCapacity(servers, disksPerServer, diskSize, ec.efficiency);

        if (actual >= capacityTiB) {
          configs.push({
            serverCount: servers,
            disksPerServer,
            diskSize,
            ecScheme: ec.scheme,
            ecEfficiency: ec.efficiency,
            tolerance: ec.tolerance,
            actualCapacity: actual,
          });
          break;
        }
      }
    }
  }

  if (configs.length === 0) {
    // 单集群（<=2000 HDD）无法满足容量 -> 超大规模两级架构（2000–20000 HDD）；
    // 超过 20000 HDD 时 planTier2 会抛出"联系 XSKY 技术支持"错误。
    const tier2 = planTier2(capacityTiB);
    return buildUltraLargeXEOSResult(tier2, capacityInfo.isBinary, bandwidthUnitType);
  }

  const best = configs.reduce((a, b) =>
    scoreConfig(a.serverCount, a.ecEfficiency, a.actualCapacity, capacityTiB) <=
    scoreConfig(b.serverCount, b.ecEfficiency, b.actualCapacity, capacityTiB) ? a : b
  );

  const totalDisks = best.serverCount * best.disksPerServer;
  const performance = calculatePerformance(totalDisks);
  const rawCapacity = calculateRawCapacity(best.serverCount, best.disksPerServer, best.diskSize);
  const cacheConfig = calculateCacheConfig(best.disksPerServer, best.diskSize);
  const poolConfig = calculatePoolConfig(best.serverCount, best.ecScheme);

  return {
    serverCount: best.serverCount,
    disksPerServer: best.disksPerServer,
    ecScheme: best.ecScheme,
    tolerance: poolConfig?.totalTolerance || best.tolerance,
    diskSize: best.diskSize,
    actualCapacity: best.actualCapacity,
    rawCapacity,
    cacheConfig,
    poolConfig,
    performance,
    formatted: {
      capacity: formatCapacity(best.actualCapacity, capacityInfo.isBinary),
      rawCapacity: formatCapacity(rawCapacity, capacityInfo.isBinary),
      uploadBandwidth: formatBandwidth(performance.uploadBandwidth, bandwidthUnitType),
      downloadBandwidth: formatBandwidth(performance.downloadBandwidth, bandwidthUnitType),
      uploadOps: `${performance.uploadOps.toLocaleString()}`,
      downloadOps: `${performance.downloadOps.toLocaleString()}`,
    },
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitType,
  };
}
