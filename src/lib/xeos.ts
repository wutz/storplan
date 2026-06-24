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
  nodesPerCluster: number; // 每簇节点数（40）
  tier2ServersTotal: number; // 二级总节点数 = clusterCount × 40
  tier2TotalHDDs: number; // 二级集群 HDD 总数
  tier2PerClusterCapacity: number; // 单簇可用容量（TiB）
  tier2CacheSSDTotal: number; // 全部二级节点缓存盘裸容量之和（TB）
  tier2PerClusterTolerance: number; // 单簇容忍离线节点数（40 节点 → 2 池 × 2 = 4）
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
  ULTRA_NODES_PER_CLUSTER: 40, // 二级数据集群每簇节点数
  METADATA_DISK_COUNTS: [2, 4, 6, 8, 10, 12, 14, 16] as const, // 一级元数据节点每节点 NVMe 数
  METADATA_DISK_SIZES: [1.92, 3.84, 7.68, 15.36] as const, // 一级元数据 NVMe 单盘容量（TB）
  METADATA_TIER_RATIO: 5, // 二级 SSD 总容量 / 一级 NVMe 总容量 = 5
  MIN_METADATA_NODES: 3,
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
  totalHDDs: number;
  totalNodes: number;
  perClusterCapacity: number; // 单簇可用容量（TiB）
  actualCapacity: number; // 全部二级集群可用容量之和（TiB）
}

// 规划二级数据集群：每簇 40 节点（EC8+2），集群数向上取整以满足容量，HDD 总数 ≤ 20000。
// 评分：主指标总 HDD 数（成本代理，等价于最小化超配），次指标总节点数。
export function planTier2(capacityTiB: number): Tier2Config {
  const nodesPerCluster = CONSTANTS.ULTRA_NODES_PER_CLUSTER;
  const ecEff = CONSTANTS.EC8_2_EFFICIENCY;
  const candidates: Tier2Config[] = [];

  for (const disksPerServer of CONSTANTS.DISKS_PER_SERVER_OPTIONS) {
    for (const diskSize of CONSTANTS.DISK_SIZES) {
      const perClusterCapacity = calculateActualCapacity(nodesPerCluster, disksPerServer, diskSize, ecEff);
      // 减去极小 epsilon 抵消浮点误差（如 3×3.2=9.600000000000001）导致的向上取整
      const numClusters = Math.max(1, Math.ceil(capacityTiB / perClusterCapacity - 1e-9));
      const totalHDDs = numClusters * nodesPerCluster * disksPerServer;
      if (totalHDDs > CONSTANTS.MAX_TOTAL_DISKS_ULTRA) continue;
      candidates.push({
        disksPerServer,
        diskSize,
        numClusters,
        totalHDDs,
        totalNodes: numClusters * nodesPerCluster,
        perClusterCapacity,
        actualCapacity: numClusters * perClusterCapacity,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error('所需容量超过 20000 块 HDD 上限（超大规模集群上限），请联系 XSKY 技术支持');
  }

  return candidates.reduce((a, b) => {
    if (a.totalHDDs !== b.totalHDDs) return a.totalHDDs < b.totalHDDs ? a : b;
    return a.totalNodes <= b.totalNodes ? a : b;
  });
}

// 规划一级元数据集群：按 二级缓存 SSD 总量 / 5 确定 NVMe 需求，节点数 ≥ 3 以满足 EC。
// 评分：主指标 NVMe 总容量（最小化超配），次指标节点数。
export function planMetadata(requiredNvmeTB: number): MetadataClusterConfig {
  const candidates: MetadataClusterConfig[] = [];

  for (const disksPerNode of CONSTANTS.METADATA_DISK_COUNTS) {
    for (const diskSize of CONSTANTS.METADATA_DISK_SIZES) {
      const perNode = disksPerNode * diskSize;
      const nodeCount = Math.max(CONSTANTS.MIN_METADATA_NODES, Math.ceil(requiredNvmeTB / perNode - 1e-9));
      // round2 抵消浮点误差，使裸容量为整洁数值
      const totalSize = Math.round(nodeCount * perNode * 100) / 100;
      const ec = getEcScheme(nodeCount);
      candidates.push({ nodeCount, disksPerNode, diskSize, totalSize, ecScheme: ec.scheme, tolerance: ec.tolerance });
    }
  }

  return candidates.reduce((a, b) => {
    if (a.totalSize !== b.totalSize) return a.totalSize < b.totalSize ? a : b;
    return a.nodeCount <= b.nodeCount ? a : b;
  });
}

// 组装超大规模两级架构结果（顶层为全部署聚合 + 二级节点代表性配置）。
export function buildUltraLargeXEOSResult(tier2: Tier2Config, isBinary: boolean, bandwidthUnitType: string): XEOSPlanResult {
  const { disksPerServer, diskSize, numClusters } = tier2;
  const nodesPerCluster = CONSTANTS.ULTRA_NODES_PER_CLUSTER;
  const tier2ServersTotal = numClusters * nodesPerCluster;
  const tier2TotalHDDs = tier2.totalHDDs;

  const cacheConfig = calculateCacheConfig(disksPerServer, diskSize);
  // round2 抵消浮点误差（如 3×3.2=9.600000000000001）
  const tier2CacheSSDTotal = Math.round(tier2ServersTotal * cacheConfig.totalSize * 100) / 100;

  const requiredNvmeTB = tier2CacheSSDTotal / CONSTANTS.METADATA_TIER_RATIO;
  const metadataCluster = planMetadata(requiredNvmeTB);
  const ratio = tier2CacheSSDTotal / metadataCluster.totalSize;

  // 40 节点 EC8+2 集群 → 2 池 × 2 = 容忍 4 节点离线
  const perClusterPool = calculatePoolConfig(nodesPerCluster, 'EC8+2');
  const tier2PerClusterTolerance = perClusterPool ? perClusterPool.totalTolerance : 2;

  const ultraLarge: UltraLargeConfig = {
    tier2ClusterCount: numClusters,
    nodesPerCluster,
    tier2ServersTotal,
    tier2TotalHDDs,
    tier2PerClusterCapacity: tier2.perClusterCapacity,
    tier2CacheSSDTotal,
    tier2PerClusterTolerance,
    metadataCluster,
    ratio,
  };

  const actualCapacity = tier2.actualCapacity;
  const rawCapacity = calculateRawCapacity(tier2ServersTotal, disksPerServer, diskSize);
  const performance = calculatePerformance(tier2TotalHDDs);

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
