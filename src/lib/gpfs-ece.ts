import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

export interface GPFSECEPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface GPFSECEPlanResult {
  serverCount: number;
  ecScheme: string;
  tolerance: number;
  ssdConfig: string;
  ssdSize: number;
  actualCapacity: number;
  rawCapacity: number;
  performance: {
    readBandwidth: number;
    writeBandwidth: number;
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
  SSDS_PER_SERVER: 24,
  TB_TO_TIB: 0.909,
  METADATA_RESERVED: 0.9,
  EC4_2P_EFFICIENCY: 0.6667,
  EC8_3P_EFFICIENCY: 0.7273,
  EC8_2P_EFFICIENCY: 0.8,
  SSD_SIZES: [7.68, 15.36] as const,
  WRITE_BW_PER_SERVER: 21800,
  READ_BW_BASE: 52000,
  READ_BW_DECAY: 636,
  READ_BW_FLOOR: 38000,
  READ_IOPS_PER_SERVER: 225000,
  WRITE_IOPS_PER_SERVER: 225000,
};

export const EC_SCHEMES = [
  { scheme: 'EC4+2P', efficiency: CONSTANTS.EC4_2P_EFFICIENCY, tolerance: 1, minServers: 3 },
  { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, tolerance: 1, minServers: 4 },
  { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 1, minServers: 5 },
] as const;

export function calculateCapacityTiB(serverCount: number, ssdSizeTB: number, ecEfficiency: number): number {
  return serverCount * CONSTANTS.SSDS_PER_SERVER * ssdSizeTB * CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.METADATA_RESERVED;
}

interface ECScheme {
  scheme: string;
  efficiency: number;
  tolerance: number;
}

export function getECScheme(serverCount: number): ECScheme {
  if (serverCount <= 3) {
    return { scheme: 'EC4+2P', efficiency: CONSTANTS.EC4_2P_EFFICIENCY, tolerance: 1 };
  }
  if (serverCount === 4) {
    return { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, tolerance: 1 };
  }
  if (serverCount <= 9) {
    return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 1 };
  }
  // 10+
  return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 2 };
}

function calculateCapacity(serverCount: number, ssdSizeTB: number, ecEfficiency: number): number {
  return serverCount * CONSTANTS.SSDS_PER_SERVER * ssdSizeTB *
         CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.METADATA_RESERVED;
}

function getReadBWPerServer(serverCount: number): number {
  const bw = CONSTANTS.READ_BW_BASE - CONSTANTS.READ_BW_DECAY * (serverCount - 3);
  return Math.max(CONSTANTS.READ_BW_FLOOR, Math.min(CONSTANTS.READ_BW_BASE, bw));
}

function calculatePerformance(serverCount: number) {
  const readBWPerServer = getReadBWPerServer(serverCount);
  return {
    readBandwidth: serverCount * readBWPerServer,
    writeBandwidth: serverCount * CONSTANTS.WRITE_BW_PER_SERVER,
    readIOPS: serverCount * CONSTANTS.READ_IOPS_PER_SERVER,
    writeIOPS: serverCount * CONSTANTS.WRITE_IOPS_PER_SERVER,
  };
}

export function buildGPFSECEResult(
  serverCount: number,
  ssdSize: number,
  ecScheme: string,
  ecEfficiency: number,
  tolerance: number,
  isBinary: boolean,
  bandwidthUnitType: string
): GPFSECEPlanResult {
  const actualCapacity = calculateCapacityTiB(serverCount, ssdSize, ecEfficiency);
  const rawCapacity = serverCount * CONSTANTS.SSDS_PER_SERVER * ssdSize * CONSTANTS.TB_TO_TIB;
  const performance = calculatePerformance(serverCount);
  return {
    serverCount, ecScheme, tolerance, ssdConfig: `24 × ${ssdSize}TB NVMe SSD`, ssdSize,
    actualCapacity, rawCapacity, performance,
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

export function planGPFSECE(req: GPFSECEPlanRequest): GPFSECEPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  let minServersForPerf = 3;

  if (req.readBandwidth) {
    const bwInfo = parseBandwidth(req.readBandwidth);
    // 简化计算：假设平均读带宽
    const avgReadBW = 45000; // MiB/s per server
    const needed = Math.ceil(bwInfo.mibps / avgReadBW);
    minServersForPerf = Math.max(minServersForPerf, needed);
  }
  if (req.writeBandwidth) {
    const bwInfo = parseBandwidth(req.writeBandwidth);
    const needed = Math.ceil(bwInfo.mibps / CONSTANTS.WRITE_BW_PER_SERVER);
    minServersForPerf = Math.max(minServersForPerf, needed);
  }

  interface Config {
    serverCount: number;
    ssdSize: number;
    ecScheme: string;
    ecEfficiency: number;
    tolerance: number;
    actualCapacity: number;
  }

  const configs: Config[] = [];

  for (const ssdSize of CONSTANTS.SSD_SIZES) {
    for (let servers = minServersForPerf; servers <= 256; servers++) {
      const ec = getECScheme(servers);
      const actual = calculateCapacity(servers, ssdSize, ec.efficiency);

      if (actual >= capacityTiB) {
        configs.push({
          serverCount: servers,
          ssdSize,
          ecScheme: ec.scheme,
          ecEfficiency: ec.efficiency,
          tolerance: ec.tolerance,
          actualCapacity: actual,
        });
        break;
      }
    }
  }

  if (configs.length === 0) {
    throw new Error('无法找到满足需求的配置');
  }

  // 选择服务器台数最少的方案
  const best = configs.reduce((a, b) => (a.serverCount <= b.serverCount ? a : b));

  const performance = calculatePerformance(best.serverCount);
  const rawCapacity = best.serverCount * CONSTANTS.SSDS_PER_SERVER * best.ssdSize * CONSTANTS.TB_TO_TIB;

  const bandwidthUnitType = req.readBandwidth || req.writeBandwidth ? 'decimal-byte' : 'decimal-byte';

  return {
    serverCount: best.serverCount,
    ecScheme: best.ecScheme,
    tolerance: best.tolerance,
    ssdConfig: `24 × ${best.ssdSize}TB NVMe SSD`,
    ssdSize: best.ssdSize,
    actualCapacity: best.actualCapacity,
    rawCapacity,
    performance,
    formatted: {
      capacity: formatCapacity(best.actualCapacity, capacityInfo.isBinary),
      rawCapacity: formatCapacity(rawCapacity, capacityInfo.isBinary),
      readBandwidth: formatBandwidth(performance.readBandwidth, bandwidthUnitType),
      writeBandwidth: formatBandwidth(performance.writeBandwidth, bandwidthUnitType),
      readIOPS: `${performance.readIOPS.toLocaleString()}`,
      writeIOPS: `${performance.writeIOPS.toLocaleString()}`,
    },
  };
}
