/**
 * GPFS/Scale 混闪规划：NVMe 层放元数据与热数据，HDD 层存主数据。
 * 性能以十节点实测报告为基准折算（见 REPORT_BASELINE）：分层开启时性能由 NVMe 层决定，
 * 关闭时由 HDD 主轴数决定。EC 与容错规则复用 gpfs-ece。
 */
import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth, MIB_TO_MB } from './utils';
import { EC_SCHEMES, getAllowedECSchemes, getGPFSTolerance, getECScheme } from './gpfs-ece';

// GPFS 混闪与全闪使用同一套 ECE 纠删码与容错规则，直接复用
export { EC_SCHEMES, getAllowedECSchemes, getGPFSTolerance, getECScheme };

/**
 * 该节点数下得盘率最高的纠删码方案。
 * 混闪以低成本大容量为目标，未显式选择时一律取得盘率最高的允许方案
 * （同得盘率时取容错更强的，即 minServers 更小的在前）。
 * 注意得盘率与容错是此消彼长：6–9 节点下 EC8+2P（80%）容忍 1 台离线，
 * 而 EC4+2P（66.7%）可容忍 2 台，需要更强容错时在界面上手动改选。
 */
export function getBestECScheme(nodeCount: number) {
  return getAllowedECSchemes(nodeCount).reduce((a, b) => (b.efficiency > a.efficiency ? b : a));
}

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

/** 单一层级的性能指标（带宽单位 MiB/s） */
export interface TierPerformance {
  readBandwidth: number;
  writeBandwidth: number;
  readIOPS: number;
  writeIOPS: number;
}

export interface FormattedTierPerformance {
  readBandwidth: string;
  writeBandwidth: string;
  readIOPS: string;
  writeIOPS: string;
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
  network: NetworkConfig;
  networkLimited: { tiered: boolean; hddOnly: boolean };
  performance: {
    /** 分层开启：热数据命中 NVMe 层 */
    tiered: TierPerformance;
    /** 分层关闭：IO 全部落在 HDD 层 */
    hddOnly: TierPerformance;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    tiered: FormattedTierPerformance;
    hddOnly: FormattedTierPerformance;
  };
}

/**
 * 性能基准：浪潮 AS13000 + GPFS 5.2.3.2 十节点实测
 * （北京并行科技浪潮分布式存储测试报告 v1.0，vdbench 50406，20 台客户端，集群网络 100G IB，存储池 4+2P）。
 * 单节点配置（AS13000G7-MS60）：2 × Xeon 5520+ 28C、16 × 32GB RDIMM、
 * 36 × 24TB SAS 7.2K HDD、4 × 15.36TB U.2 NVMe、2 × 480GB SATA SSD 系统盘、2 × 双口 HDR100 IB。
 * 报告分别实测了开启分层（热数据在 NVMe 层）与关闭分层（IO 全落 HDD 层）两种模式。
 */
export const REPORT_BASELINE = {
  source: '浪潮 AS13000 + GPFS 5.2.3.2 十节点实测（北京并行科技测试报告 v1.0，vdbench 50406，20 客户端，100G IB，存储池 4+2P）',
  nodeCount: 10,
  hddPerNode: 36,
  hddSizeTB: 24,
  cacheDisksPerNode: 4,
  cacheSizeTB: 15.36,
  ecScheme: 'EC4+2P',
  // 报告实测网络为 100G IB；默认选择的 RoCE 同速率下模型结果相同，但仍属预测
  networkType: 'ib',
  networkSpeed: 100,
  // 分层开启：读写由 NVMe 层承载
  tiered: {
    readBandwidthGBps: 48.69,
    writeBandwidthGBps: 36.6,
    readIOPS: 351752,
    writeIOPS: 180605,
  },
  // 分层关闭：读写全部落在 HDD 层
  hddOnly: {
    readBandwidthGBps: 32.37,
    writeBandwidthGBps: 18.7,
    readIOPS: 42529,
    writeIOPS: 22729,
  },
} as const;

const BASELINE_TOTAL_HDD = REPORT_BASELINE.nodeCount * REPORT_BASELINE.hddPerNode;
const BASELINE_TOTAL_CACHE = REPORT_BASELINE.nodeCount * REPORT_BASELINE.cacheDisksPerNode;

const toMiBps = (gbps: number) => (gbps * 1000) / MIB_TO_MB;

/** 分层开启时性能由 NVMe 层决定：按实测摊到每块 NVMe */
export const PER_CACHE_PERF = {
  readMiBps: toMiBps(REPORT_BASELINE.tiered.readBandwidthGBps) / BASELINE_TOTAL_CACHE,
  writeMiBps: toMiBps(REPORT_BASELINE.tiered.writeBandwidthGBps) / BASELINE_TOTAL_CACHE,
  readIOPS: REPORT_BASELINE.tiered.readIOPS / BASELINE_TOTAL_CACHE,
  writeIOPS: REPORT_BASELINE.tiered.writeIOPS / BASELINE_TOTAL_CACHE,
} as const;

/** 分层关闭时性能由 HDD 主轴数决定：按实测摊到每块 HDD */
export const PER_HDD_PERF = {
  readMiBps: toMiBps(REPORT_BASELINE.hddOnly.readBandwidthGBps) / BASELINE_TOTAL_HDD,
  writeMiBps: toMiBps(REPORT_BASELINE.hddOnly.writeBandwidthGBps) / BASELINE_TOTAL_HDD,
  readIOPS: REPORT_BASELINE.hddOnly.readIOPS / BASELINE_TOTAL_HDD,
  writeIOPS: REPORT_BASELINE.hddOnly.writeIOPS / BASELINE_TOTAL_HDD,
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
  // NVMe 层（元数据 + 热数据）规格与盘数区间与 Ceph 混闪索引盘对齐
  CACHE_DISK_SIZES: [1.6, 1.92, 3.2, 3.84, 6.4, 7.68, 12.8, 15.36] as const,
  // 自动选型优先使用 1.92 系列规格；1.6 系列仅供手动选择
  AUTO_CACHE_DISK_SIZES: [1.92, 3.84, 7.68, 15.36] as const,
  MIN_CACHE_DISKS: 1,
  MAX_CACHE_DISKS: 4,
  // 单节点 NVMe 裸容量占单节点 HDD 裸容量的比例：不得低于 5%，推荐 10%
  CACHE_MIN_RATIO: 0.05,
  CACHE_RECOMMENDED_RATIO: 0.1,
  // 存储网络：类型只影响协议效率，速率决定单节点带宽上限。
  // IB 无 25Gb 规格（IB 速率档为 EDR/HDR 100G 起），故 25Gb 只提供 RoCE 与 Eth
  NETWORK_TYPES: [
    { value: 'roce', label: 'RoCE', efficiency: 0.9, speeds: [100, 25] },
    { value: 'ib', label: 'IB', efficiency: 0.9, speeds: [100] },
    { value: 'eth', label: 'ETH', efficiency: 0.8, speeds: [100, 25] },
  ] as const,
  NETWORK_SPEEDS: [100, 25] as const, // Gb/s 单端口
  DEFAULT_NETWORK_TYPE: 'roce',
  DEFAULT_NETWORK_SPEED: 100,
  // 双口绑定用于存储网络，第二张卡按冗余计不叠加吞吐
  STORAGE_PORTS_PER_NODE: 2,
};

/** 该速率下可选的网络类型（IB 仅 100Gb 有对应规格） */
export function getAllowedNetworkTypes(speedGb: number) {
  return CONSTANTS.NETWORK_TYPES.filter(t => (t.speeds as readonly number[]).includes(speedGb));
}

export interface NetworkConfig {
  type: string;
  speedGb: number;
  label: string;
  /** 单节点读带宽上限（MiB/s）：读只取 D 份数据块，不含校验块，无网络放大 */
  perNodeReadCeiling: number;
  /** 单节点写带宽上限（MiB/s）：写需同时下发 D+P 份，按网络放大折算 */
  perNodeWriteCeiling: number;
  /** 纠删码网络放大系数 (D+P)/D，仅作用于写 */
  amplification: number;
}

/** 纠删码网络放大系数：一次全条带写需要跨节点搬运 (D+P)/D 倍数据（读只取 D 份，不放大） */
export function getECAmplification(ecScheme: string): number {
  const m = ecScheme.match(/EC(\d+)\+(\d+)/);
  if (!m) return 1;
  const d = Number(m[1]);
  const p = Number(m[2]);
  return (d + p) / d;
}

export function getNetworkConfig(type: string, speedGb: number, ecScheme: string): NetworkConfig {
  // 所选类型在该速率下无对应规格时（如 25Gb IB）回退到该速率的首个可选类型
  const allowed = getAllowedNetworkTypes(speedGb);
  const t = allowed.find(n => n.value === type) ?? allowed[0] ?? CONSTANTS.NETWORK_TYPES[0];
  const amplification = getECAmplification(ecScheme);
  // 端口总速率 → MiB/s，扣协议效率；写再按纠删码网络放大折算，读不折算
  const wireMiBps = (CONSTANTS.STORAGE_PORTS_PER_NODE * speedGb / 8) * 1000 / MIB_TO_MB;
  const usable = wireMiBps * t.efficiency;
  return {
    type: t.value,
    speedGb,
    label: `${CONSTANTS.STORAGE_PORTS_PER_NODE} × 双口 ${speedGb}Gb ${t.label} 网卡`,
    perNodeReadCeiling: usable,
    perNodeWriteCeiling: usable / amplification,
    amplification,
  };
}

export function calculateCapacityTiB(
  nodeCount: number,
  hddPerNode: number,
  hddSizeTB: number,
  ecEfficiency: number
): number {
  return nodeCount * hddPerNode * hddSizeTB * CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.SYSTEM_RESERVED;
}

/** 单节点 NVMe 容量的下限与推荐值（按单节点 HDD 裸容量的 5% / 10%） */
export function getCacheRequirement(hddPerNode: number, hddSizeTB: number) {
  const rawHddTB = hddPerNode * hddSizeTB;
  return {
    rawHddTB,
    minTB: rawHddTB * CONSTANTS.CACHE_MIN_RATIO,
    recommendedTB: rawHddTB * CONSTANTS.CACHE_RECOMMENDED_RATIO,
  };
}

/**
 * NVMe 层配置：固定配满 4 块（分层性能随 NVMe 数量线性增长，配满即取最大性能），
 * 在此基础上取能达到推荐 10% 的最小规格；4 块最大规格仍够不到推荐值时用最大规格，
 * 保证不低于 5% 下限。
 */
export function calculateCacheConfig(hddPerNode: number, hddSizeTB: number): HybridCacheConfig {
  const { recommendedTB } = getCacheRequirement(hddPerNode, hddSizeTB);
  const count = CONSTANTS.MAX_CACHE_DISKS;
  const sizes = [...CONSTANTS.AUTO_CACHE_DISK_SIZES].sort((a, b) => a - b);
  const sizePerDisk = sizes.find(s => count * s >= recommendedTB) ?? sizes[sizes.length - 1];
  return { count, sizePerDisk, totalSize: Math.round(count * sizePerDisk * 100) / 100 };
}

/**
 * 分层开启按集群 NVMe 总数外推，分层关闭按集群 HDD 总数外推，
 * 两者都以十节点实测为基准。
 */
export function calculatePerformance(
  nodeCount: number,
  hddPerNode: number,
  cacheCount: number,
  network?: NetworkConfig
) {
  const totalHDD = nodeCount * hddPerNode;
  const totalCache = nodeCount * cacheCount;
  // 4KiB 小 IO 的网络占用极低（几十万 IOPS 也只有 GB/s 量级），仅对带宽做网络封顶
  const readCeiling = network ? network.perNodeReadCeiling * nodeCount : Infinity;
  const writeCeiling = network ? network.perNodeWriteCeiling * nodeCount : Infinity;

  const hddOnlyDisk = {
    readBandwidth: totalHDD * PER_HDD_PERF.readMiBps,
    writeBandwidth: totalHDD * PER_HDD_PERF.writeMiBps,
  };
  const hddOnly: TierPerformance = {
    readBandwidth: Math.min(hddOnlyDisk.readBandwidth, readCeiling),
    writeBandwidth: Math.min(hddOnlyDisk.writeBandwidth, writeCeiling),
    readIOPS: Math.round(totalHDD * PER_HDD_PERF.readIOPS),
    writeIOPS: Math.round(totalHDD * PER_HDD_PERF.writeIOPS),
  };

  // NVMe 层配置过小时其聚合能力可能低于 HDD 层；开启分层后 HDD 池仍然承载冷数据，
  // 因此 HDD 层结果构成下限，取两者较大值避免出现「开分层反而更慢」的失真。
  const tieredDisk = {
    readBandwidth: Math.max(totalCache * PER_CACHE_PERF.readMiBps, hddOnlyDisk.readBandwidth),
    writeBandwidth: Math.max(totalCache * PER_CACHE_PERF.writeMiBps, hddOnlyDisk.writeBandwidth),
  };
  const tiered: TierPerformance = {
    readBandwidth: Math.min(tieredDisk.readBandwidth, readCeiling),
    writeBandwidth: Math.min(tieredDisk.writeBandwidth, writeCeiling),
    readIOPS: Math.max(Math.round(totalCache * PER_CACHE_PERF.readIOPS), hddOnly.readIOPS),
    writeIOPS: Math.max(Math.round(totalCache * PER_CACHE_PERF.writeIOPS), hddOnly.writeIOPS),
  };

  return {
    tiered,
    hddOnly,
    // 是否有指标被存储网络限制（用于界面提示）
    networkLimited: {
      tiered: tieredDisk.readBandwidth > readCeiling || tieredDisk.writeBandwidth > writeCeiling,
      hddOnly: hddOnlyDisk.readBandwidth > readCeiling || hddOnlyDisk.writeBandwidth > writeCeiling,
    },
  };
}

/**
 * 自动规划时选网卡：在满足需求的前提下取最低规格（省成本）。
 * 「满足」= 既达到给定的带宽需求，又不限制磁盘侧能力（两层都不被网络封顶）——
 * 只按带宽需求判断会让 25Gb 恒定胜出（HDD 层本就跑不满 25Gb），
 * 从而悄悄削掉 SSD 层性能，故要求网卡不成为瓶颈。
 * 类型固定用默认值（RoCE）：速率是成本档位，类型是架构选择，不代为降级。
 */
export function pickLowestSufficientNetwork(
  nodeCount: number,
  hddPerNode: number,
  cacheCount: number,
  ecScheme: string,
  readBWReq = 0,
  writeBWReq = 0
): NetworkConfig {
  const speeds = [...CONSTANTS.NETWORK_SPEEDS].sort((a, b) => a - b);
  let fallback: NetworkConfig | undefined;
  for (const speed of speeds) {
    const network = getNetworkConfig(CONSTANTS.DEFAULT_NETWORK_TYPE, speed, ecScheme);
    const perf = calculatePerformance(nodeCount, hddPerNode, cacheCount, network);
    fallback = network;
    const meetsDemand = perf.hddOnly.readBandwidth >= readBWReq && perf.hddOnly.writeBandwidth >= writeBWReq;
    const notBottleneck = !perf.networkLimited.tiered && !perf.networkLimited.hddOnly;
    if (meetsDemand && notBottleneck) return network;
  }
  // 连最高规格都不满足时返回最高规格，由调用方按带宽判定该配置是否可行
  return fallback!;
}

function formatTier(perf: TierPerformance, bandwidthUnitType: string): FormattedTierPerformance {
  return {
    readBandwidth: formatBandwidth(perf.readBandwidth, bandwidthUnitType),
    writeBandwidth: formatBandwidth(perf.writeBandwidth, bandwidthUnitType),
    readIOPS: `${perf.readIOPS.toLocaleString()}`,
    writeIOPS: `${perf.writeIOPS.toLocaleString()}`,
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
  cacheSizePerDisk?: number,
  networkType: string = CONSTANTS.DEFAULT_NETWORK_TYPE,
  networkSpeed: number = CONSTANTS.DEFAULT_NETWORK_SPEED
): GPFSHybridPlanResult {
  const allowed = getAllowedECSchemes(nodeCount);
  const scheme = (ecScheme && allowed.find(s => s.scheme === ecScheme)) || getBestECScheme(nodeCount);
  const tolerance = getGPFSTolerance(nodeCount, scheme.scheme);
  const actualCapacity = calculateCapacityTiB(nodeCount, hddPerNode, hddSize, scheme.efficiency);
  const rawCapacity = nodeCount * hddPerNode * hddSize * CONSTANTS.TB_TO_TIB;
  const cacheConfig = cacheCount && cacheSizePerDisk
    ? { count: cacheCount, sizePerDisk: cacheSizePerDisk, totalSize: Math.round(cacheCount * cacheSizePerDisk * 100) / 100 }
    : calculateCacheConfig(hddPerNode, hddSize);
  const network = getNetworkConfig(networkType, networkSpeed, scheme.scheme);
  const { tiered, hddOnly, networkLimited } = calculatePerformance(nodeCount, hddPerNode, cacheConfig.count, network);
  const performance = { tiered, hddOnly };

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
    network,
    networkLimited,
    performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      tiered: formatTier(performance.tiered, bandwidthUnitType),
      hddOnly: formatTier(performance.hddOnly, bandwidthUnitType),
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
    networkSpeed: number;
  }

  const configs: Config[] = [];
  const hddPerNode = CONSTANTS.DEFAULT_HDD_PER_NODE;

  for (const hddSize of CONSTANTS.HDD_SIZES) {
    const cache = calculateCacheConfig(hddPerNode, hddSize);
    for (let nodes = CONSTANTS.MIN_NODES; nodes <= CONSTANTS.MAX_NODES; nodes++) {
      const ec = getBestECScheme(nodes);
      const actual = calculateCapacityTiB(nodes, hddPerNode, hddSize, ec.efficiency);
      // 满足需求的前提下取最低网卡规格
      const net = pickLowestSufficientNetwork(nodes, hddPerNode, cache.count, ec.scheme, readBWReq, writeBWReq);
      // 带宽需求按分层关闭（HDD 层）口径校验：冷数据全部落盘时仍能满足
      const perf = calculatePerformance(nodes, hddPerNode, cache.count, net).hddOnly;
      if (actual >= capacityTiB && perf.readBandwidth >= readBWReq && perf.writeBandwidth >= writeBWReq) {
        configs.push({ nodeCount: nodes, hddSize, actualCapacity: actual, networkSpeed: net.speedGb });
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

  return buildGPFSHybridResult(
    best.nodeCount,
    hddPerNode,
    best.hddSize,
    capacityInfo.isBinary,
    'decimal-byte',
    undefined,
    undefined,
    undefined,
    CONSTANTS.DEFAULT_NETWORK_TYPE,
    best.networkSpeed
  );
}
