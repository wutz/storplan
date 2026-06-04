import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

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

const CONSTANTS = {
  MIN_EBOX: 11,
  MAX_EBOX: 250,
  TB_TO_TIB: 0.909,
  // EBox 配置 (每个 EBox)
  EBOX_CONFIGS: [
    { diskSize: 15.36, label: '2×800GB SCM + 8×15.36TB NVMe', rawPerEbox: 122.88 },
    { diskSize: 30.72, label: '2×1.6TB SCM + 8×30.72TB NVMe', rawPerEbox: 245.76 },
    { diskSize: 61.44, label: '3×1.6TB SCM + 7×61.44TB NVMe', rawPerEbox: 430.08 },
  ],
  // EBox 性能 (per EBox)
  READ_BW_PER_EBOX: 21, // GB/s
  SUSTAINED_WRITE_BW_PER_EBOX: 2.6, // GB/s
  BURST_WRITE_BW_PER_EBOX: 10, // GB/s
  READ_IOPS_PER_EBOX: 180000,
  WRITE_IOPS_PER_EBOX: 23750,
  // 可用容量系数 (考虑元数据、副本等)
  USABLE_RATIO: 0.728,
};

function calculateEboxConfig(eboxCount: number, diskConfig: typeof CONSTANTS.EBOX_CONFIGS[0]) {
  const rawTB = eboxCount * diskConfig.rawPerEbox;
  const usableTiB = rawTB * CONSTANTS.TB_TO_TIB * CONSTANTS.USABLE_RATIO;

  return {
    eboxCount,
    diskSize: diskConfig.diskSize,
    diskConfig: diskConfig.label,
    actualCapacity: usableTiB,
    rawCapacity: rawTB * CONSTANTS.TB_TO_TIB,
    performance: {
      readBandwidth: eboxCount * CONSTANTS.READ_BW_PER_EBOX * 1000, // MiB/s
      writeBandwidth: eboxCount * CONSTANTS.SUSTAINED_WRITE_BW_PER_EBOX * 1000,
      burstWriteBandwidth: eboxCount * CONSTANTS.BURST_WRITE_BW_PER_EBOX * 1000,
      readIOPS: eboxCount * CONSTANTS.READ_IOPS_PER_EBOX,
      writeIOPS: eboxCount * CONSTANTS.WRITE_IOPS_PER_EBOX,
    },
  };
}

export function planVastData(req: VastDataPlanRequest): VastDataPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  let minEboxForPerf = CONSTANTS.MIN_EBOX;

  if (req.readBandwidth) {
    const bwInfo = parseBandwidth(req.readBandwidth);
    const needed = Math.ceil(bwInfo.mibps / (CONSTANTS.READ_BW_PER_EBOX * 1000));
    minEboxForPerf = Math.max(minEboxForPerf, needed);
  }
  if (req.writeBandwidth) {
    const bwInfo = parseBandwidth(req.writeBandwidth);
    const needed = Math.ceil(bwInfo.mibps / (CONSTANTS.SUSTAINED_WRITE_BW_PER_EBOX * 1000));
    minEboxForPerf = Math.max(minEboxForPerf, needed);
  }

  // Find smallest config that meets requirements
  let bestConfig = null;
  for (const diskConfig of CONSTANTS.EBOX_CONFIGS) {
    for (let ebox = minEboxForPerf; ebox <= CONSTANTS.MAX_EBOX; ebox++) {
      const config = calculateEboxConfig(ebox, diskConfig);
      if (config.actualCapacity >= capacityTiB) {
        if (!bestConfig || ebox < bestConfig.eboxCount) {
          bestConfig = config;
        }
        break;
      }
    }
  }

  if (!bestConfig) {
    throw new Error('无法找到满足需求的配置（超出 250 EBox 限制）');
  }

  const bandwidthUnitType = req.readBandwidth || req.writeBandwidth ? 'decimal-byte' : 'decimal-byte';

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
