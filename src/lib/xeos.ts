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
}

export const CONSTANTS = {
  DISKS_PER_SERVER_OPTIONS: [24, 26, 28, 30, 32, 34, 36] as const,
  MAX_TOTAL_DISKS: 2000,
  MAX_SERVERS: 4096,
  SPACE_OVERHEAD: 0.81,
  EC8_2_EFFICIENCY: 0.8,
  EC4_2_EFFICIENCY: 0.6667,
  READ_BW_PER_DISK: 70,
  WRITE_BW_PER_DISK: 46,
  READ_OPS_PER_DISK: 333,
  WRITE_OPS_PER_DISK: 83,
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8] as const,
  TB_TO_TIB: 0.909,
  CACHE_DISK_SIZES: [1.6, 3.2, 6.4, 12.8] as const,
  MAX_CACHE_DISKS: 4,
  MIN_CACHE_DISKS: 1,
  CACHE_RATIO: 80,
};

export const EC_SCHEMES = [
  { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1, minServers: 3 },
  { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1, minServers: 5 },
  { scheme: 'EC4+2', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 2, minServers: 6 },
  { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2, minServers: 10 },
] as const;

export function calculateCacheConfig(disksPerServer: number, diskSizeTB: number): CacheConfig {
  const requiredCacheTB = (disksPerServer * diskSizeTB) / CONSTANTS.CACHE_RATIO;

  // 默认尝试使用最大 4 块缓存盘
  for (let count = CONSTANTS.MAX_CACHE_DISKS; count >= CONSTANTS.MIN_CACHE_DISKS; count--) {
    for (const sizePerDisk of [...CONSTANTS.CACHE_DISK_SIZES].reverse()) {
      const totalSize = count * sizePerDisk;
      if (totalSize >= requiredCacheTB) {
        return { count, sizePerDisk, totalSize };
      }
    }
  }

  // 如果都不满足，返回最大配置
  const maxSize = CONSTANTS.MAX_CACHE_DISKS * CONSTANTS.CACHE_DISK_SIZES[CONSTANTS.CACHE_DISK_SIZES.length - 1];
  return {
    count: CONSTANTS.MAX_CACHE_DISKS,
    sizePerDisk: CONSTANTS.CACHE_DISK_SIZES[CONSTANTS.CACHE_DISK_SIZES.length - 1],
    totalSize: maxSize,
  };
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
    throw new Error('无法找到满足需求的配置（可能超出 2000 块 HDD 上限）');
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
