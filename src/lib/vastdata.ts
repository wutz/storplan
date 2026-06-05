import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';
import { EBOX_CAPACITY_DATA, EBOX_PERFORMANCE_DATA } from './vastdata-data';

interface EboxCapacityEntry {
  ebox_count: number;
  usable_tib: number;
}

interface EboxPerformanceEntry {
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
  mode: 'ebox';
  eboxCount: number;
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
  MIN_EBOX: 11,
  MAX_EBOX: 250,
  TB_TO_TIB: 0.909,
  EBOX_CONFIGS: [
    { diskSize: 15.36, label: '2×800GB SCM + 8×15.36TB NVMe', rawPerEbox: 122.88 },
    { diskSize: 30.72, label: '2×1.6TB SCM + 8×30.72TB NVMe', rawPerEbox: 245.76 },
    { diskSize: 61.44, label: '3×1.6TB SCM + 7×61.44TB NVMe', rawPerEbox: 430.08 },
  ] as { diskSize: number; label: string; rawPerEbox: number }[],
};

export function calculateCapacityTiB(eboxCount: number, diskSize: number): number {
  const data = EBOX_CAPACITY_DATA[diskSize];
  if (!data) throw new Error(`Unknown disk size: ${diskSize}`);
  const entry = data.find((e: EboxCapacityEntry) => e.ebox_count === eboxCount);
  if (!entry) throw new Error(`No capacity data for ${eboxCount} EBox`);
  return entry.usable_tib;
}

function getPerformance(eboxCount: number) {
  const perf = EBOX_PERFORMANCE_DATA.find((p: EboxPerformanceEntry) => p.ebox_count === eboxCount);
  if (!perf) throw new Error(`No performance data for ${eboxCount} EBox`);
  return {
    readBandwidth: perf.read_bw_gbs * 1000,
    writeBandwidth: perf.sustained_write_bw_gbs * 1000,
    burstWriteBandwidth: perf.burst_write_bw_gbs * 1000,
    readIOPS: perf.read_iops_k * 1000,
    writeIOPS: perf.write_iops_k * 1000,
  };
}

function calculateEboxConfig(eboxCount: number, diskConfig: typeof CONSTANTS.EBOX_CONFIGS[0]) {
  const capacityData = EBOX_CAPACITY_DATA[diskConfig.diskSize];
  if (!capacityData) throw new Error(`Unknown disk size: ${diskConfig.diskSize}`);
  const capEntry = capacityData.find((e: EboxCapacityEntry) => e.ebox_count === eboxCount);
  if (!capEntry) throw new Error(`No capacity data for ${eboxCount} EBox`);

  const rawTB = eboxCount * diskConfig.rawPerEbox;

  return {
    eboxCount,
    diskSize: diskConfig.diskSize,
    diskConfig: diskConfig.label,
    actualCapacity: capEntry.usable_tib,
    rawCapacity: rawTB * CONSTANTS.TB_TO_TIB,
    performance: getPerformance(eboxCount),
  };
}

export function buildVastDataResult(
  eboxCount: number,
  diskSize: number,
  diskConfig: string,
  isBinary: boolean,
  bandwidthUnitType: string
): VastDataPlanResult {
  const config = CONSTANTS.EBOX_CONFIGS.find(c => c.diskSize === diskSize)!;
  const capacityData = EBOX_CAPACITY_DATA[diskSize];
  if (!capacityData) throw new Error(`Unknown disk size: ${diskSize}`);
  const capEntry = capacityData.find((e: EboxCapacityEntry) => e.ebox_count === eboxCount);
  if (!capEntry) throw new Error(`No capacity data for ${eboxCount} EBox`);

  const rawTB = eboxCount * config.rawPerEbox;
  const performance = getPerformance(eboxCount);

  return {
    mode: 'ebox',
    eboxCount,
    diskSize,
    diskConfig,
    actualCapacity: capEntry.usable_tib,
    rawCapacity: rawTB * CONSTANTS.TB_TO_TIB,
    performance,
    formatted: {
      capacity: formatCapacity(capEntry.usable_tib, isBinary),
      rawCapacity: formatCapacity(rawTB * CONSTANTS.TB_TO_TIB, isBinary),
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
    readBwGbs = bwInfo.mibps / 1000;
  }
  if (req.writeBandwidth) {
    const bwInfo = parseBandwidth(req.writeBandwidth);
    writeBwGbs = bwInfo.mibps / 1000;
  }

  let bestConfig = null;
  for (const diskConfig of CONSTANTS.EBOX_CONFIGS) {
    const capacityData = EBOX_CAPACITY_DATA[diskConfig.diskSize];
    if (!capacityData) continue;

    for (let ebox = CONSTANTS.MIN_EBOX; ebox <= CONSTANTS.MAX_EBOX; ebox++) {
      const capEntry = capacityData.find((e: EboxCapacityEntry) => e.ebox_count === ebox);
      const perfEntry = EBOX_PERFORMANCE_DATA.find((p: EboxPerformanceEntry) => p.ebox_count === ebox);
      if (!capEntry || !perfEntry) continue;

      const ok =
        capEntry.usable_tib >= capacityTiB &&
        (!readBwGbs || perfEntry.read_bw_gbs >= readBwGbs) &&
        (!writeBwGbs || perfEntry.sustained_write_bw_gbs >= writeBwGbs);

      if (ok) {
        if (!bestConfig || ebox < bestConfig.eboxCount) {
          bestConfig = calculateEboxConfig(ebox, diskConfig);
        }
        break;
      }
    }
  }

  if (!bestConfig) {
    throw new Error('无法找到满足需求的配置（超出 250 EBox 限制）');
  }

  const bandwidthUnitType = 'decimal-byte';

  return {
    mode: 'ebox',
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
