import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';
import { EBOX_CAPACITY_DATA, EBOX_PERFORMANCE_DATA } from './vastdata-data';

interface NodeCapacityEntry {
  ebox_count: number;
  usable_tib: number;
  raw_per_ebox_tib: number;
}

interface NodePerformanceEntry {
  ebox_count: number;
  read_bw_gbs: number;
  sustained_write_bw_gbs: number;
  burst_write_bw_gbs: number;
  read_iops_k: number;
  write_iops_k: number;
}

export interface VastDataPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface VastDataPlanResult {
  mode: 'node';
  nodeCount: number;
  diskConfig: string;
  diskSize: number;
  actualCapacity: number;
  rawCapacity: number;
  performance: {
    readBandwidth: number;
    writeBandwidth: number;
    burstWriteBandwidth: number;
    readIOPS: number;
    writeIOPS: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    readBandwidth: string;
    writeBandwidth: string;
    burstWriteBandwidth: string;
    readIOPS: string;
    writeIOPS: string;
  };
}

export const CONSTANTS = {
  MIN_NODES: 11,
  MAX_NODES: 250,
  TB_TO_TIB: 0.909,
  NODE_CONFIGS: [
    { diskSize: 15.36, label: '2×800GB SCM + 8×15.36TB NVMe', rawPerNode: 122.88 },
    { diskSize: 30.72, label: '2×1.6TB SCM + 8×30.72TB NVMe', rawPerNode: 245.76 },
    { diskSize: 61.44, label: '3×1.6TB SCM + 7×61.44TB NVMe', rawPerNode: 430.08 },
  ] as { diskSize: number; label: string; rawPerNode: number }[],
};

export function calculateCapacityTiB(nodeCount: number, diskSize: number): number {
  const data = EBOX_CAPACITY_DATA[diskSize];
  if (!data) throw new Error(`Unknown disk size: ${diskSize}`);
  const entry = data.find((e: NodeCapacityEntry) => e.ebox_count === nodeCount);
  if (!entry) throw new Error(`No capacity data for ${nodeCount} nodes`);
  return entry.usable_tib;
}

function getPerformance(nodeCount: number) {
  const perf = EBOX_PERFORMANCE_DATA.find((p: NodePerformanceEntry) => p.ebox_count === nodeCount);
  if (!perf) throw new Error(`No performance data for ${nodeCount} nodes`);
  return {
    readBandwidth: perf.read_bw_gbs * 1000 / 1.024,
    writeBandwidth: perf.sustained_write_bw_gbs * 1000 / 1.024,
    burstWriteBandwidth: perf.burst_write_bw_gbs * 1000 / 1.024,
    readIOPS: perf.read_iops_k * 1000,
    writeIOPS: perf.write_iops_k * 1000,
  };
}

function calculateNodeConfig(nodeCount: number, diskConfig: typeof CONSTANTS.NODE_CONFIGS[0]) {
  const capacityData = EBOX_CAPACITY_DATA[diskConfig.diskSize];
  if (!capacityData) throw new Error(`Unknown disk size: ${diskConfig.diskSize}`);
  const capEntry = capacityData.find((e: NodeCapacityEntry) => e.ebox_count === nodeCount);
  if (!capEntry) throw new Error(`No capacity data for ${nodeCount} nodes`);

  return {
    nodeCount,
    diskSize: diskConfig.diskSize,
    diskConfig: diskConfig.label,
    actualCapacity: capEntry.usable_tib,
    rawCapacity: nodeCount * capEntry.raw_per_ebox_tib,
    performance: getPerformance(nodeCount),
  };
}

export function buildVastDataResult(
  nodeCount: number,
  diskSize: number,
  diskConfig: string,
  isBinary: boolean,
  bandwidthUnitType: string
): VastDataPlanResult {
  const capacityData = EBOX_CAPACITY_DATA[diskSize];
  if (!capacityData) throw new Error(`Unknown disk size: ${diskSize}`);
  const capEntry = capacityData.find((e: NodeCapacityEntry) => e.ebox_count === nodeCount);
  if (!capEntry) throw new Error(`No capacity data for ${nodeCount} nodes`);

  const performance = getPerformance(nodeCount);

  return {
    mode: 'node',
    nodeCount,
    diskSize,
    diskConfig,
    actualCapacity: capEntry.usable_tib,
    rawCapacity: nodeCount * capEntry.raw_per_ebox_tib,
    performance,
    formatted: {
      capacity: formatCapacity(capEntry.usable_tib, isBinary),
      rawCapacity: formatCapacity(nodeCount * capEntry.raw_per_ebox_tib, isBinary),
      readBandwidth: formatBandwidth(performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(performance.writeBandwidth, bandwidthUnitType),
      burstWriteBandwidth: formatBandwidth(performance.burstWriteBandwidth, bandwidthUnitType),
      readIOPS: `${performance.readIOPS.toLocaleString()}`,
      writeIOPS: `${performance.writeIOPS.toLocaleString()}`,
    },
  };
}

export function planVastData(req: VastDataPlanRequest): VastDataPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  let readBwGbs: number | undefined;
  let writeBwGbs: number | undefined;

  if (req.readBandwidth) {
    const bwInfo = parseBandwidth(req.readBandwidth);
    readBwGbs = bwInfo.mibps * 1.024 / 1000;
  }
  if (req.writeBandwidth) {
    const bwInfo = parseBandwidth(req.writeBandwidth);
    writeBwGbs = bwInfo.mibps * 1.024 / 1000;
  }

  let bestConfig = null;
  for (const diskConfig of CONSTANTS.NODE_CONFIGS) {
    const capacityData = EBOX_CAPACITY_DATA[diskConfig.diskSize];
    if (!capacityData) continue;

    for (let node = CONSTANTS.MIN_NODES; node <= CONSTANTS.MAX_NODES; node++) {
      const capEntry = capacityData.find((e: NodeCapacityEntry) => e.ebox_count === node);
      const perfEntry = EBOX_PERFORMANCE_DATA.find((p: NodePerformanceEntry) => p.ebox_count === node);
      if (!capEntry || !perfEntry) continue;

      const ok =
        capEntry.usable_tib >= capacityTiB &&
        (!readBwGbs || perfEntry.read_bw_gbs >= readBwGbs) &&
        (!writeBwGbs || perfEntry.sustained_write_bw_gbs >= writeBwGbs);

      if (ok) {
        if (!bestConfig || node < bestConfig.nodeCount) {
          bestConfig = calculateNodeConfig(node, diskConfig);
        }
        break;
      }
    }
  }

  if (!bestConfig) {
    throw new Error('无法找到满足需求的配置（超出 250 节点限制）');
  }

  const bandwidthUnitType = 'decimal-byte';

  return {
    mode: 'node',
    ...bestConfig,
    formatted: {
      capacity: formatCapacity(bestConfig.actualCapacity, capacityInfo.isBinary),
      rawCapacity: formatCapacity(bestConfig.rawCapacity, capacityInfo.isBinary),
      readBandwidth: formatBandwidth(bestConfig.performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(bestConfig.performance.writeBandwidth, bandwidthUnitType),
      burstWriteBandwidth: formatBandwidth(bestConfig.performance.burstWriteBandwidth, bandwidthUnitType),
      readIOPS: `${bestConfig.performance.readIOPS.toLocaleString()}`,
      writeIOPS: `${bestConfig.performance.writeIOPS.toLocaleString()}`,
    },
  };
}
