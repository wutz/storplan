import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth, MIB_TO_MB } from './utils';
import { EC_SCHEMES, getAllowedECSchemes, getGPFSTolerance, getECScheme } from './gpfs-ece';

// GPFS 混闪与全闪使用同一套 ECE 纠删码与容错规则，直接复用
export { EC_SCHEMES, getAllowedECSchemes, getGPFSTolerance, getECScheme };

export interface GPFSHybridPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface HybridCacheConfig {
  count: number;
  sizePerDisk: number;
  totalSize: number;
}

export interface GPFSHybridPlanResult {
  nodeCount: number;
  hddPerNode: number;
  hddSize: number; // 单块 HDD 容量（TB）
  ecScheme: string;
  efficiency: number;
  tolerance: number;
  actualCapacity: number; // TiB（仅 HDD 数据层）
  rawCapacity: number; // TiB（仅 HDD 数据层）
  cacheConfig: HybridCacheConfig; // 每节点 NVMe 元数据/热数据层
  cacheTotalTB: number; // 全集群 NVMe 总容量（TB）
  performance: {
    readBandwidth: number; // MiB/s
    writeBandwidth: number; // MiB/s
    readIOPS: number;
    writeIOPS: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    readBandwidth: string;
    writeBandwidth: string;
    readIOPS: string;
    writeIOPS: string;
  };
}

/**
 * 性能基准：浪潮 AS13000 混闪三节点实测（2026-05-19 测试报告）。
 * 工具 vdbench 50406，14 台客户端，4MB 顺序写 / 随机读、4KB 读写。
 * 单节点配置：2 × Xeon Gold 5520+、512GB 内存、4 × 16TB NVMe SSD、36 × 24TB SATA HDD、2 × 100Gb 业务网卡。
 */
export const REPORT_BASELINE = {
  source: '浪潮 AS13000 混闪三节点实测（2026-05-19 报告，vdbench 50406，14 客户端）',
  nodeCount: 3,
  hddPerNode: 36,
  hddSizeTB: 24,
  cacheDisksPerNode: 4,
  cacheSizeTB: 16,
  readBandwidthGBps: 16.8,
  writeBandwidthGBps: 6.77,
  readIOPS: 147058,
  writeIOPS: 72744,
  readLatencyMs: 1.996,
  writeLatencyMs: 2.348,
} as const;

const BASELINE_TOTAL_HDD = REPORT_BASELINE.nodeCount * REPORT_BASELINE.hddPerNode;
const BASELINE_TOTAL_CACHE = REPORT_BASELINE.nodeCount * REPORT_BASELINE.cacheDisksPerNode;

// 4MB 大块带宽由 HDD 数据层主轴数决定：按实测总带宽摊到每块 HDD
export const PER_HDD_BANDWIDTH = {
  readMiBps: (REPORT_BASELINE.readBandwidthGBps * 1000) / MIB_TO_MB / BASELINE_TOTAL_HDD,
  writeMiBps: (REPORT_BASELINE.writeBandwidthGBps * 1000) / MIB_TO_MB / BASELINE_TOTAL_HDD,
} as const;

// 4KB 小 IO 命中 NVMe 层：按实测总 IOPS 摊到每块 NVMe
export const PER_CACHE_IOPS = {
  readIOPS: REPORT_BASELINE.readIOPS / BASELINE_TOTAL_CACHE,
  writeIOPS: REPORT_BASELINE.writeIOPS / BASELINE_TOTAL_CACHE,
} as const;

export const CONSTANTS = {
  MIN_NODES: 3,
  MAX_NODES: 256,
  HDD_PER_NODE_OPTIONS: [24, 26, 28, 30, 32, 34, 36] as const,
  DEFAULT_HDD_PER_NODE: REPORT_BASELINE.hddPerNode,
  HDD_SIZES: [24, 22, 20, 18, 16, 12, 10, 8] as const, // TB HDD
  TB_TO_TIB: 0.909,
  // 元数据落在 NVMe 层，HDD 数据层仅保留系统开销
  SYSTEM_RESERVED: 0.95,
  // NVMe 层（元数据 + 热数据）全部可选规格（UI 手动选择）
  CACHE_DISK_SIZES: [3.84, 7.68, 15.36, 16, 30.72] as const,
  // 自动选型使用的规格
  AUTO_CACHE_DISK_SIZES: [3.84, 7.68, 15.36, 16] as const,
  MIN_CACHE_DISKS: 2,
  MAX_CACHE_DISKS: 8,
  // NVMe 总容量 ≥ HDD 总容量 / 15（基准配置 36×24TB HDD 配 4×16TB NVMe，约 1/13.5，高于此下限）
  CACHE_RATIO: 15,
};

export function calculateCapacityTiB(
  nodeCount: number,
  hddPerNode: number,
  hddSizeTB: number,
  ecEfficiency: number
): number {
  return nodeCount * hddPerNode * hddSizeTB * CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.SYSTEM_RESERVED;
}

// NVMe 层配置：遍历 (盘数 × 容量) 组合，选总容量满足下限且浪费最小的；同等接近时优先更多盘数（IOPS 更高）
export function calculateCacheConfig(hddPerNode: number, hddSizeTB: number): HybridCacheConfig {
  const requiredCacheTB = (hddPerNode * hddSizeTB) / CONSTANTS.CACHE_RATIO;

  let bestCount = CONSTANTS.MAX_CACHE_DISKS;
  let bestSize = CONSTANTS.AUTO_CACHE_DISK_SIZES[CONSTANTS.AUTO_CACHE_DISK_SIZES.length - 1];
  let bestWaste = Infinity;

  for (let count = CONSTANTS.MIN_CACHE_DISKS; count <= CONSTANTS.MAX_CACHE_DISKS; count++) {
    for (const sizePerDisk of CONSTANTS.AUTO_CACHE_DISK_SIZES) {
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

// 带宽随 HDD 总数线性外推，IOPS 随 NVMe 总数线性外推（均以三节点实测为基准）
export function calculatePerformance(nodeCount: number, hddPerNode: number, cacheCount: number) {
  const totalHDD = nodeCount * hddPerNode;
  const totalCache = nodeCount * cacheCount;
  return {
    readBandwidth: totalHDD * PER_HDD_BANDWIDTH.readMiBps,
    writeBandwidth: totalHDD * PER_HDD_BANDWIDTH.writeMiBps,
    readIOPS: Math.round(totalCache * PER_CACHE_IOPS.readIOPS),
    writeIOPS: Math.round(totalCache * PER_CACHE_IOPS.writeIOPS),
  };
}

export function buildGPFSHybridResult(
  nodeCount: number,
  hddPerNode: number,
  hddSize: number,
  isBinary: boolean,
  bandwidthUnitType: string = 'decimal-byte',
  ecScheme?: string,
  cacheCount?: number,
  cacheSizePerDisk?: number
): GPFSHybridPlanResult {
  const allowed = getAllowedECSchemes(nodeCount);
  const scheme = (ecScheme && allowed.find(s => s.scheme === ecScheme)) || getECScheme(nodeCount);
  const tolerance = getGPFSTolerance(nodeCount, scheme.scheme);
  const actualCapacity = calculateCapacityTiB(nodeCount, hddPerNode, hddSize, scheme.efficiency);
  const rawCapacity = nodeCount * hddPerNode * hddSize * CONSTANTS.TB_TO_TIB;
  const cacheConfig = cacheCount && cacheSizePerDisk
    ? { count: cacheCount, sizePerDisk: cacheSizePerDisk, totalSize: Math.round(cacheCount * cacheSizePerDisk * 100) / 100 }
    : calculateCacheConfig(hddPerNode, hddSize);
  const performance = calculatePerformance(nodeCount, hddPerNode, cacheConfig.count);

  return {
    nodeCount,
    hddPerNode,
    hddSize,
    ecScheme: scheme.scheme,
    efficiency: scheme.efficiency,
    tolerance,
    actualCapacity,
    rawCapacity,
    cacheConfig,
    cacheTotalTB: Math.round(nodeCount * cacheConfig.totalSize * 100) / 100,
    performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      readBandwidth: formatBandwidth(performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(performance.writeBandwidth, bandwidthUnitType),
      readIOPS: `${performance.readIOPS.toLocaleString()}`,
      writeIOPS: `${performance.writeIOPS.toLocaleString()}`,
    },
  };
}

export function planGPFSHybrid(req: GPFSHybridPlanRequest): GPFSHybridPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;
  const readBWReq = req.readBandwidth ? parseBandwidth(req.readBandwidth).mibps : 0;
  const writeBWReq = req.writeBandwidth ? parseBandwidth(req.writeBandwidth).mibps : 0;

  interface Config {
    nodeCount: number;
    hddSize: number;
    actualCapacity: number;
  }

  const configs: Config[] = [];
  const hddPerNode = CONSTANTS.DEFAULT_HDD_PER_NODE;

  for (const hddSize of CONSTANTS.HDD_SIZES) {
    const cache = calculateCacheConfig(hddPerNode, hddSize);
    for (let nodes = CONSTANTS.MIN_NODES; nodes <= CONSTANTS.MAX_NODES; nodes++) {
      const ec = getECScheme(nodes);
      const actual = calculateCapacityTiB(nodes, hddPerNode, hddSize, ec.efficiency);
      const perf = calculatePerformance(nodes, hddPerNode, cache.count);
      if (actual >= capacityTiB && perf.readBandwidth >= readBWReq && perf.writeBandwidth >= writeBWReq) {
        configs.push({ nodeCount: nodes, hddSize, actualCapacity: actual });
        break;
      }
    }
  }

  if (configs.length === 0) {
    throw new Error('无法找到满足需求的配置');
  }

  // 选择节点数最少的方案；节点数相同时选可用容量最接近需求（更省成本）的方案
  const best = configs.reduce((a, b) => {
    if (a.nodeCount !== b.nodeCount) return a.nodeCount < b.nodeCount ? a : b;
    return a.actualCapacity <= b.actualCapacity ? a : b;
  });

  return buildGPFSHybridResult(best.nodeCount, hddPerNode, best.hddSize, capacityInfo.isBinary);
}
