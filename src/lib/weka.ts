import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth, MIB_TO_MB } from './utils';

export interface WekaPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface WekaProtection {
  D: number;
  P: number;
  stripeWidth: number;
  efficiency: number;
  scheme: string;
}

export interface WekaPlanResult {
  nodeCount: number;        // 总节点数（数据 + 热备）
  dataNodeCount: number;    // 数据节点数
  hotSpareCount: number;
  nvmePerNode: number;
  ssdSize: number;
  protectionLevel: number;  // P（2/3/4）
  protection: WekaProtection;
  networkType: string;      // '100gb' | '200gb'
  actualCapacity: number;   // TiB
  rawCapacity: number;      // TiB
  performance: {
    readBandwidth: number;  // MiB/s
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

export const CONSTANTS = {
  MIN_TOTAL_NODES: 6,               // 最小总节点数（数据节点 + 热备节点）
  HOT_SPARE: 1,                     // 热备节点数（不参与容量计算，参与性能计算）
  NVME_COUNTS: [4, 8, 12] as const,
  NVME_PER_NODE: 12,
  SSD_SIZES: [7.68, 15.36] as const,
  PROTECTION_LEVELS: [2, 3, 4] as const,
  DEFAULT_PROTECTION_LEVEL: 2,
  DEFAULT_NETWORK: '200gb',
  TB_TO_TIB: 0.909,
  METADATA_RESERVED: 0.9,           // 10% 元数据和系统保留

  // 性能公式系数（GB/s，按每 NVMe 折算）
  WRITE_BW_PER_NVME_GBPS: 0.6625,
  READ_BW_PER_NVME_GBPS: 4.346,     // 无网络瓶颈时
  WRITE_IOPS_PER_NVME: 27000,
  READ_IOPS_PER_NVME: 220875,

  // 网络带宽限制（GB/s，每节点）
  NETWORK_BW_100GB: 22.5,
  NETWORK_BW_200GB: 45.0,
};

const GBPS_TO_MIBPS = 1000 / MIB_TO_MB;

/**
 * 热备节点数：5 台数据节点（最小规模）时不配热备，6 台及以上配 1 台热备
 */
export function getHotSpareCount(dataNodeCount: number): number {
  return dataNodeCount <= 5 ? 0 : CONSTANTS.HOT_SPARE;
}

/**
 * 根据数据节点数和保护级别确定保护方案（EC D+P）
 * 约束：D+P ≤ 节点数，D+P ≤ 20，D > P，条带宽度 5–20
 */
export function getProtectionScheme(dataNodeCount: number, protectionLevel = CONSTANTS.DEFAULT_PROTECTION_LEVEL): WekaProtection {
  const P = protectionLevel;

  const D = Math.min(dataNodeCount - P, 20 - P);

  if (D <= P) {
    throw new Error(`数据块 (D=${D}) 必须大于校验块 (P=${P})，节点数不足`);
  }

  const stripeWidth = D + P;
  if (stripeWidth < 5 || stripeWidth > 20) {
    throw new Error(`条带宽度 (${stripeWidth}) 必须在 5-20 范围内`);
  }

  return { D, P, stripeWidth, efficiency: D / stripeWidth, scheme: `EC ${D}+${P}` };
}

/**
 * 可用容量 (TiB)，基于数据节点数
 */
export function calculateCapacityTiB(dataNodeCount: number, ssdSizeTB: number, protectionLevel = CONSTANTS.DEFAULT_PROTECTION_LEVEL, nvmePerNode = CONSTANTS.NVME_PER_NODE): number {
  const protection = getProtectionScheme(dataNodeCount, protectionLevel);
  return dataNodeCount * nvmePerNode * ssdSizeTB * CONSTANTS.TB_TO_TIB * protection.efficiency * CONSTANTS.METADATA_RESERVED;
}

/**
 * 集群性能（基于总节点数，含热备），返回 MiB/s
 */
export function calculatePerformance(totalNodeCount: number, networkType: string = CONSTANTS.DEFAULT_NETWORK, nvmePerNode = CONSTANTS.NVME_PER_NODE) {
  const totalNvme = totalNodeCount * nvmePerNode;
  const writeBWGbps = totalNvme * CONSTANTS.WRITE_BW_PER_NVME_GBPS;
  const networkBWPerNode = networkType === '100gb' ? CONSTANTS.NETWORK_BW_100GB : CONSTANTS.NETWORK_BW_200GB;
  const readBWGbps = Math.min(totalNvme * CONSTANTS.READ_BW_PER_NVME_GBPS, totalNodeCount * networkBWPerNode);

  return {
    readBandwidth: readBWGbps * GBPS_TO_MIBPS,
    writeBandwidth: writeBWGbps * GBPS_TO_MIBPS,
    readIOPS: totalNvme * CONSTANTS.READ_IOPS_PER_NVME,
    writeIOPS: totalNvme * CONSTANTS.WRITE_IOPS_PER_NVME,
  };
}

export function buildWekaResult(
  dataNodeCount: number,
  ssdSize: number,
  protectionLevel: number,
  networkType: string,
  isBinary: boolean,
  bandwidthUnitType: string,
  hotSpareOverride?: number,
  nvmePerNode: number = CONSTANTS.NVME_PER_NODE,
): WekaPlanResult {
  const protection = getProtectionScheme(dataNodeCount, protectionLevel);
  const hotSpareCount = hotSpareOverride !== undefined && hotSpareOverride >= 0 ? hotSpareOverride : getHotSpareCount(dataNodeCount);
  const totalNodes = dataNodeCount + hotSpareCount;
  const actualCapacity = calculateCapacityTiB(dataNodeCount, ssdSize, protectionLevel, nvmePerNode);
  const rawCapacity = dataNodeCount * nvmePerNode * ssdSize * CONSTANTS.TB_TO_TIB;
  const performance = calculatePerformance(totalNodes, networkType, nvmePerNode);

  return {
    nodeCount: totalNodes,
    dataNodeCount,
    hotSpareCount,
    nvmePerNode,
    ssdSize,
    protectionLevel,
    protection,
    networkType,
    actualCapacity,
    rawCapacity,
    performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      readBandwidth: formatBandwidth(performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(performance.writeBandwidth, bandwidthUnitType),
      readIOPS: `${Math.floor(performance.readIOPS).toLocaleString()}`,
      writeIOPS: `${Math.floor(performance.writeIOPS).toLocaleString()}`,
    },
  };
}

export function planWeka(req: WekaPlanRequest): WekaPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  let readBWReq = 0;
  let writeBWReq = 0;
  if (req.readBandwidth) readBWReq = parseBandwidth(req.readBandwidth).mibps;
  if (req.writeBandwidth) writeBWReq = parseBandwidth(req.writeBandwidth).mibps;

  const networkType = CONSTANTS.DEFAULT_NETWORK;
  const minDataNodes = 5;
  const MAX_DATA_NODES = 1000;

  // 从最小节点数向上搜索，优先小盘（成本最低），满足容量与性能即返回
  for (let nodes = minDataNodes; nodes <= MAX_DATA_NODES; nodes++) {
    // 数据节点 ≥ 100 台时保护级别自动取 4
    const protectionLevel = nodes >= 100 ? 4 : CONSTANTS.DEFAULT_PROTECTION_LEVEL;
    for (const ssdSize of CONSTANTS.SSD_SIZES) {
      let actual: number;
      try {
        actual = calculateCapacityTiB(nodes, ssdSize, protectionLevel);
      } catch {
        continue;
      }
      if (actual < capacityTiB) continue;

      const perf = calculatePerformance(nodes + getHotSpareCount(nodes), networkType);
      if (perf.readBandwidth < readBWReq || perf.writeBandwidth < writeBWReq) continue;

      const bandwidthUnitType = 'decimal-byte';
      return buildWekaResult(nodes, ssdSize, protectionLevel, networkType, capacityInfo.isBinary, bandwidthUnitType);
    }
  }

  throw new Error('无法找到满足所有需求的配置方案');
}
