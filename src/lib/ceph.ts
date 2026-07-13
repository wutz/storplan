import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

export interface CephPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface CephPlanResult {
  nodeCount: number;
  disksPerNode: number;
  diskSize: number;
  redundancy: string;
  efficiency: number;
  tolerance: number;
  actualCapacity: number; // TiB
  rawCapacity: number; // TiB
  performance: {
    readBandwidth: number; // MiB/s
    writeBandwidth: number; // MiB/s
    readIOPS: number;
    writeIOPS: number;
  };
  rgwPerformance: {
    readBandwidth: number; // MiB/s
    writeBandwidth: number; // MiB/s
    readOPS: number;
    writeOPS: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    readBandwidth: string;
    writeBandwidth: string;
    readIOPS: string;
    writeIOPS: string;
    rgwReadBandwidth: string;
    rgwWriteBandwidth: string;
    rgwReadOPS: string;
    rgwWriteOPS: string;
  };
}

export const CONSTANTS = {
  MIN_NODES: 3,
  MAX_NODES: 1000,
  DISKS_PER_NODE_OPTIONS: [4, 8, 12, 16, 20, 24] as const,
  DEFAULT_DISKS_PER_NODE: 24,
  DISK_SIZES: [3.84, 7.68, 15.36] as const,
  TB_TO_TIB: 0.909,
  // 数据均衡损失：每盘容量均衡度低，可用容量按 70% 计算
  BALANCE_FACTOR: 0.7,
  // 单节点盘数 ≤ 12 时，单条内存容量减半为 16GB
  MEM_HALF_THRESHOLD: 12,
};

// Ceph 数据冗余策略（按节点数固定）：
// 3 节点 → 3 副本；4-5 节点 → EC2+2；6-7 节点 → EC4+2；8-9 节点 → EC6+2；10+ 节点 → EC8+2
export interface RedundancyScheme {
  scheme: string;
  efficiency: number; // 得盘率
  tolerance: number; // 容忍离线节点数
  notRecommended?: boolean; // 生产环境不建议
}

export const REDUNDANCY_SCHEMES: RedundancyScheme[] = [
  { scheme: 'EC8+2', efficiency: 8 / 10, tolerance: 2 },
  { scheme: 'EC6+2', efficiency: 6 / 8, tolerance: 2 },
  { scheme: 'EC4+2', efficiency: 4 / 6, tolerance: 2 },
  { scheme: 'EC2+2', efficiency: 2 / 4, tolerance: 2 },
  { scheme: '3 副本', efficiency: 1 / 3, tolerance: 2 },
  { scheme: '2 副本', efficiency: 1 / 2, tolerance: 1, notRecommended: true },
];

export function getRedundancyScheme(nodeCount: number): RedundancyScheme {
  if (nodeCount <= 3) return REDUNDANCY_SCHEMES.find(s => s.scheme === '3 副本')!;
  if (nodeCount <= 5) return REDUNDANCY_SCHEMES.find(s => s.scheme === 'EC2+2')!;
  if (nodeCount <= 7) return REDUNDANCY_SCHEMES.find(s => s.scheme === 'EC4+2')!;
  if (nodeCount <= 9) return REDUNDANCY_SCHEMES.find(s => s.scheme === 'EC6+2')!;
  return REDUNDANCY_SCHEMES.find(s => s.scheme === 'EC8+2')!;
}

// 各节点数允许选择的冗余策略（默认策略 + 允许额外选择的更低策略）
export function getAllowedRedundancySchemes(nodeCount: number): RedundancyScheme[] {
  const order = ['EC8+2', 'EC6+2', 'EC4+2', 'EC2+2', '3 副本', '2 副本'];
  const defaultScheme = getRedundancyScheme(nodeCount).scheme;
  const startIdx = order.indexOf(defaultScheme);
  return order.slice(startIdx).map(name => REDUNDANCY_SCHEMES.find(s => s.scheme === name)!);
}

// 内存配置：与 GPFS ECE 相同（16 × 32GB DDR5）；单节点盘数 ≤ 12 时单条容量减半为 16GB
export function getMemoryConfig(disksPerNode: number): { dimmCount: number; dimmSizeGB: number; totalGB: number } {
  const dimmSizeGB = disksPerNode <= CONSTANTS.MEM_HALF_THRESHOLD ? 16 : 32;
  return { dimmCount: 16, dimmSizeGB, totalGB: 16 * dimmSizeGB };
}

// 存储网络配置：2 × 双口 200Gb 以太网；单节点盘数 ≤ 12 时降为 2 × 双口 100Gb 以太网
export function getStorageNetworkConfig(disksPerNode: number): { nicCount: number; speedGb: number; label: string } {
  const speedGb = disksPerNode <= CONSTANTS.MEM_HALF_THRESHOLD ? 100 : 200;
  return { nicCount: 2, speedGb, label: `2 × 双口 ${speedGb}Gb 以太网卡` };
}

// CephFS / Ceph RBD 每盘平均性能（按冗余策略）
// 读/写单位：MiB/s；IOPS 单位：次/秒
export interface PerDiskPerformance {
  readMiBps: number;
  writeMiBps: number;
  readIOPS: number;
  writeIOPS: number;
}

export function getPerDiskPerformance(scheme: string): PerDiskPerformance {
  switch (scheme) {
    case '2 副本': // 参考 3 副本
    case '3 副本':
      return { readMiBps: 1540, writeMiBps: 440, readIOPS: 20000, writeIOPS: 8000 };
    case 'EC2+2':
      return { readMiBps: 1030, writeMiBps: 560, readIOPS: 15000, writeIOPS: 4000 };
    case 'EC4+2':
    case 'EC6+2':
      return { readMiBps: 820, writeMiBps: 620, readIOPS: 14000, writeIOPS: 3500 };
    case 'EC8+2':
    default:
      return { readMiBps: 640, writeMiBps: 490, readIOPS: 9000, writeIOPS: 2900 };
  }
}

// 集群性能 = 集群盘总数 × 每盘平均性能
export function calculatePerformance(nodeCount: number, disksPerNode: number, scheme: string) {
  const perDisk = getPerDiskPerformance(scheme);
  const totalDisks = nodeCount * disksPerNode;
  return {
    readBandwidth: totalDisks * perDisk.readMiBps,
    writeBandwidth: totalDisks * perDisk.writeMiBps,
    readIOPS: totalDisks * perDisk.readIOPS,
    writeIOPS: totalDisks * perDisk.writeIOPS,
  };
}

// Ceph RGW 对象存储每盘平均性能（与冗余策略无关）
// 读/写单位：MiB/s；OPS 单位：次/秒
export const RGW_PER_DISK = {
  readMiBps: 470,
  writeMiBps: 260,
  readOPS: 1250,
  writeOPS: 260,
} as const;

// RGW 集群性能 = 集群盘总数 × 每盘平均性能
export function calculateRgwPerformance(nodeCount: number, disksPerNode: number) {
  const totalDisks = nodeCount * disksPerNode;
  return {
    readBandwidth: totalDisks * RGW_PER_DISK.readMiBps,
    writeBandwidth: totalDisks * RGW_PER_DISK.writeMiBps,
    readOPS: totalDisks * RGW_PER_DISK.readOPS,
    writeOPS: totalDisks * RGW_PER_DISK.writeOPS,
  };
}

// Ceph 容量计算：
// (节点数量 - 1) × 冗余策略得盘率 × 单节点盘数 × 单盘容量 × 0.7（数据均衡损失）
export function calculateCapacityTiB(
  nodeCount: number,
  disksPerNode: number,
  diskSizeTB: number,
  efficiency?: number
): number {
  const eff = efficiency ?? getRedundancyScheme(nodeCount).efficiency;
  return (
    (nodeCount - 1) *
    eff *
    disksPerNode *
    diskSizeTB *
    CONSTANTS.TB_TO_TIB *
    CONSTANTS.BALANCE_FACTOR
  );
}

export function buildCephResult(
  nodeCount: number,
  disksPerNode: number,
  diskSize: number,
  isBinary: boolean,
  bandwidthUnitType: string = 'decimal-byte',
  redundancyScheme?: string
): CephPlanResult {
  const allowed = getAllowedRedundancySchemes(nodeCount);
  const scheme = (redundancyScheme && allowed.find(s => s.scheme === redundancyScheme)) || getRedundancyScheme(nodeCount);
  const actualCapacity = calculateCapacityTiB(nodeCount, disksPerNode, diskSize, scheme.efficiency);
  const rawCapacity = nodeCount * disksPerNode * diskSize * CONSTANTS.TB_TO_TIB;
  const performance = calculatePerformance(nodeCount, disksPerNode, scheme.scheme);
  const rgwPerformance = calculateRgwPerformance(nodeCount, disksPerNode);
  return {
    nodeCount,
    disksPerNode,
    diskSize,
    redundancy: scheme.scheme,
    efficiency: scheme.efficiency,
    tolerance: scheme.tolerance,
    actualCapacity,
    rawCapacity,
    performance,
    rgwPerformance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      readBandwidth: formatBandwidth(performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(performance.writeBandwidth, bandwidthUnitType),
      readIOPS: `${performance.readIOPS.toLocaleString()}`,
      writeIOPS: `${performance.writeIOPS.toLocaleString()}`,
      rgwReadBandwidth: formatBandwidth(rgwPerformance.readBandwidth, bandwidthUnitType),
      rgwWriteBandwidth: formatBandwidth(rgwPerformance.writeBandwidth, bandwidthUnitType),
      rgwReadOPS: `${rgwPerformance.readOPS.toLocaleString()}`,
      rgwWriteOPS: `${rgwPerformance.writeOPS.toLocaleString()}`,
    },
  };
}

export function planCeph(req: CephPlanRequest): CephPlanResult {
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

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    for (let nodes = CONSTANTS.MIN_NODES; nodes <= CONSTANTS.MAX_NODES; nodes++) {
      const scheme = getRedundancyScheme(nodes);
      const actual = calculateCapacityTiB(nodes, CONSTANTS.DEFAULT_DISKS_PER_NODE, diskSize, scheme.efficiency);
      const perf = calculatePerformance(nodes, CONSTANTS.DEFAULT_DISKS_PER_NODE, scheme.scheme);
      if (actual >= capacityTiB && perf.readBandwidth >= readBWReq && perf.writeBandwidth >= writeBWReq) {
        configs.push({ nodeCount: nodes, diskSize, actualCapacity: actual });
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

  return buildCephResult(best.nodeCount, CONSTANTS.DEFAULT_DISKS_PER_NODE, best.diskSize, capacityInfo.isBinary);
}
