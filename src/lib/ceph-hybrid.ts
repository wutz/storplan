import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';
import {
  getRedundancyScheme,
  getAllowedRedundancySchemes,
  calculateCapacityTiB,
  CONSTANTS as CEPH_CONSTANTS,
} from './ceph';
import type { RedundancyScheme } from './ceph';

export { getRedundancyScheme, getAllowedRedundancySchemes, calculateCapacityTiB };
export type { RedundancyScheme };

export interface CephHybridPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface HybridCacheConfig {
  count: number;
  sizePerDisk: number;
  totalSize: number;
}

export interface CephHybridPlanResult {
  nodeCount: number;
  disksPerNode: number;
  diskSize: number; // HDD 单盘容量（TB）
  redundancy: string;
  efficiency: number;
  tolerance: number;
  actualCapacity: number; // TiB
  rawCapacity: number; // TiB
  cacheConfig: HybridCacheConfig;
  rgwPerformance: {
    readBandwidth: number; // MiB/s
    writeBandwidth: number; // MiB/s
    readOPS: number;
    writeOPS: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    rgwReadBandwidth: string;
    rgwWriteBandwidth: string;
    rgwReadOPS: string;
    rgwWriteOPS: string;
  };
}

// 混闪硬件规划借鉴 XSKY XEOS 单集群（< 20000 HDD）方案
export const CONSTANTS = {
  MIN_NODES: 3,
  MAX_NODES: 1000,
  DISKS_PER_NODE_OPTIONS: [24, 26, 28, 30, 32, 34, 36] as const,
  DEFAULT_DISKS_PER_NODE: 32,
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8] as const, // TB HDD
  MAX_TOTAL_DISKS: 20000, // 单集群 HDD 总数上限
  TB_TO_TIB: CEPH_CONSTANTS.TB_TO_TIB,
  BALANCE_FACTOR: CEPH_CONSTANTS.BALANCE_FACTOR,
  // 索引缓存盘（NVMe SSD，DWPD ≥ 3）：总容量 ≥ HDD 总容量 / 80
  CACHE_DISK_SIZES: [1.6, 3.2, 6.4, 12.8] as const,
  MIN_CACHE_DISKS: 1,
  MAX_CACHE_DISKS: 4,
  CACHE_RATIO: 80,
};

// Ceph RGW 混闪每 HDD 平均性能。
// 吞吐以 MiB/s 为内部规范单位，60 MB/s = 60/1.024 MiB/s，显示时还原为 MB/s
export const RGW_HYBRID_PER_DISK = {
  readMiBps: 60 / 1.024,
  writeMiBps: 30 / 1.024,
  readOPS: 285,
  writeOPS: 50,
} as const;

// 索引缓存盘配置：遍历 (盘数 × 容量) 组合，选总容量最接近需求（浪费最小）的；同等接近时优先更多盘数
export function calculateCacheConfig(disksPerNode: number, diskSizeTB: number): HybridCacheConfig {
  const requiredCacheTB = (disksPerNode * diskSizeTB) / CONSTANTS.CACHE_RATIO;

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

  return { count: bestCount, sizePerDisk: bestSize, totalSize: Math.round(bestCount * bestSize * 100) / 100 };
}

// RGW 集群性能 = 集群 HDD 总数 × 每盘平均性能
export function calculateRgwHybridPerformance(nodeCount: number, disksPerNode: number) {
  const totalDisks = nodeCount * disksPerNode;
  return {
    readBandwidth: totalDisks * RGW_HYBRID_PER_DISK.readMiBps,
    writeBandwidth: totalDisks * RGW_HYBRID_PER_DISK.writeMiBps,
    readOPS: totalDisks * RGW_HYBRID_PER_DISK.readOPS,
    writeOPS: totalDisks * RGW_HYBRID_PER_DISK.writeOPS,
  };
}

export function buildCephHybridResult(
  nodeCount: number,
  disksPerNode: number,
  diskSize: number,
  isBinary: boolean,
  bandwidthUnitType: string = 'decimal-byte',
  redundancyScheme?: string,
  cacheCount?: number,
  cacheSizePerDisk?: number
): CephHybridPlanResult {
  const allowed = getAllowedRedundancySchemes(nodeCount);
  const scheme = (redundancyScheme && allowed.find(s => s.scheme === redundancyScheme)) || getRedundancyScheme(nodeCount);
  const actualCapacity = calculateCapacityTiB(nodeCount, disksPerNode, diskSize, scheme.efficiency);
  const rawCapacity = nodeCount * disksPerNode * diskSize * CONSTANTS.TB_TO_TIB;
  const rgwPerformance = calculateRgwHybridPerformance(nodeCount, disksPerNode);
  const cacheConfig = cacheCount && cacheSizePerDisk
    ? { count: cacheCount, sizePerDisk: cacheSizePerDisk, totalSize: Math.round(cacheCount * cacheSizePerDisk * 100) / 100 }
    : calculateCacheConfig(disksPerNode, diskSize);

  return {
    nodeCount,
    disksPerNode,
    diskSize,
    redundancy: scheme.scheme,
    efficiency: scheme.efficiency,
    tolerance: scheme.tolerance,
    actualCapacity,
    rawCapacity,
    cacheConfig,
    rgwPerformance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      rgwReadBandwidth: formatBandwidth(rgwPerformance.readBandwidth, bandwidthUnitType),
      rgwWriteBandwidth: formatBandwidth(rgwPerformance.writeBandwidth, bandwidthUnitType),
      rgwReadOPS: `${rgwPerformance.readOPS.toLocaleString()}`,
      rgwWriteOPS: `${rgwPerformance.writeOPS.toLocaleString()}`,
    },
  };
}

export function planCephHybrid(req: CephHybridPlanRequest): CephHybridPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;
  const readBWReq = req.readBandwidth ? parseBandwidth(req.readBandwidth).mibps : 0;
  const writeBWReq = req.writeBandwidth ? parseBandwidth(req.writeBandwidth).mibps : 0;

  interface Config {
    nodeCount: number;
    diskSize: number;
    actualCapacity: number;
  }

  const configs: Config[] = [];
  const disksPerNode = CONSTANTS.DEFAULT_DISKS_PER_NODE;

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    for (let nodes = CONSTANTS.MIN_NODES; nodes <= CONSTANTS.MAX_NODES; nodes++) {
      if (nodes * disksPerNode > CONSTANTS.MAX_TOTAL_DISKS) break;
      const scheme = getRedundancyScheme(nodes);
      const actual = calculateCapacityTiB(nodes, disksPerNode, diskSize, scheme.efficiency);
      const perf = calculateRgwHybridPerformance(nodes, disksPerNode);
      if (actual >= capacityTiB && perf.readBandwidth >= readBWReq && perf.writeBandwidth >= writeBWReq) {
        configs.push({ nodeCount: nodes, diskSize, actualCapacity: actual });
        break;
      }
    }
  }

  if (configs.length === 0) {
    throw new Error('所需规模超过 20000 块 HDD 上限（单集群上限），无法找到满足需求的配置');
  }

  // 选择节点数最少的方案；节点数相同时选可用容量最接近需求（更省成本）的方案
  const best = configs.reduce((a, b) => {
    if (a.nodeCount !== b.nodeCount) return a.nodeCount < b.nodeCount ? a : b;
    return a.actualCapacity <= b.actualCapacity ? a : b;
  });

  return buildCephHybridResult(best.nodeCount, disksPerNode, best.diskSize, capacityInfo.isBinary);
}
