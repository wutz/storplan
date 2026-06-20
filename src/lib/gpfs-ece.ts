import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

export interface GPFSECEPlanRequest {
  capacity: string;
  readBandwidth?: string;
  writeBandwidth?: string;
}

export interface GPFSECEPlanResult {
  serverCount: number;
  ssdCount: number;
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
  SSD_COUNTS: [4, 8, 12, 16, 20, 24] as const,
  SSDS_PER_SERVER: 24,
  MAX_SERVERS: 256,
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
  { scheme: 'EC4+2P', efficiency: CONSTANTS.EC4_2P_EFFICIENCY, minServers: 3 },
  { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, minServers: 4 },
  { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, minServers: 5 },
] as const;

export function getAllowedECSchemes(serverCount: number) {
  if (serverCount === 3) {
    // 3 nodes: only EC4+2P
    return [EC_SCHEMES[0]]; // EC4+2P
  }
  if (serverCount === 4) {
    // 4 nodes: only EC4+2P and EC8+3P
    return [EC_SCHEMES[0], EC_SCHEMES[1]]; // EC4+2P, EC8+3P
  }
  if (serverCount === 5) {
    // 5 nodes: all schemes allowed
    return [...EC_SCHEMES];
  }
  if (serverCount >= 6 && serverCount <= 9) {
    // 6-9 nodes: all schemes allowed
    return [...EC_SCHEMES];
  }
  // 10+ nodes: all schemes
  return [...EC_SCHEMES];
}

export function getGPFSTolerance(serverCount: number, scheme: string): number {
  if (serverCount === 3) return 1;
  if (serverCount === 4) return 1;
  if (serverCount === 5) return 1;
  if (serverCount >= 6 && serverCount <= 9) {
    // EC4+2P can tolerate 2 nodes offline for 6-9 nodes
    if (scheme === 'EC4+2P') return 2;
    return 1;
  }
  if (serverCount >= 10) {
    // EC8+3P with 11+ nodes tolerates 3 nodes offline
    if (scheme === 'EC8+3P' && serverCount >= 11) return 3;
    return 2;
  }
  return 1;
}

export function calculateCapacityTiB(serverCount: number, ssdSizeTB: number, ecEfficiency: number, ssdCount: number = CONSTANTS.SSDS_PER_SERVER): number {
  return serverCount * ssdCount * ssdSizeTB * CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.METADATA_RESERVED;
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
    // Default to EC8+3P for 4 nodes
    return { scheme: 'EC8+3P', efficiency: CONSTANTS.EC8_3P_EFFICIENCY, tolerance: 1 };
  }
  if (serverCount >= 5 && serverCount <= 9) {
    // Default to EC8+2P for 5-9 nodes, tolerance 1
    return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 1 };
  }
  // 10+ nodes: EC8+2P with tolerance 2
  return { scheme: 'EC8+2P', efficiency: CONSTANTS.EC8_2P_EFFICIENCY, tolerance: 2 };
}

function calculateCapacity(serverCount: number, ssdSizeTB: number, ecEfficiency: number, ssdCount: number = CONSTANTS.SSDS_PER_SERVER): number {
  return serverCount * ssdCount * ssdSizeTB *
         CONSTANTS.TB_TO_TIB * ecEfficiency * CONSTANTS.METADATA_RESERVED;
}

function getReadBWPerServer(serverCount: number): number {
  const bw = CONSTANTS.READ_BW_BASE - CONSTANTS.READ_BW_DECAY * (serverCount - 3);
  return Math.max(CONSTANTS.READ_BW_FLOOR, Math.min(CONSTANTS.READ_BW_BASE, bw));
}

function calculatePerformance(serverCount: number, ssdCount: number = CONSTANTS.SSDS_PER_SERVER) {
  const readBWPerServer = getReadBWPerServer(serverCount);
  const ssdFactor = ssdCount / CONSTANTS.SSDS_PER_SERVER;
  return {
    readBandwidth: serverCount * readBWPerServer * ssdFactor,
    writeBandwidth: serverCount * CONSTANTS.WRITE_BW_PER_SERVER * ssdFactor,
    readIOPS: serverCount * CONSTANTS.READ_IOPS_PER_SERVER * ssdFactor,
    writeIOPS: serverCount * CONSTANTS.WRITE_IOPS_PER_SERVER * ssdFactor,
  };
}

export function buildGPFSECEResult(
  serverCount: number,
  ssdSize: number,
  ecScheme: string,
  ecEfficiency: number,
  tolerance: number,
  isBinary: boolean,
  bandwidthUnitType: string,
  ssdCount: number = CONSTANTS.SSDS_PER_SERVER
): GPFSECEPlanResult {
  const actualCapacity = calculateCapacityTiB(serverCount, ssdSize, ecEfficiency, ssdCount);
  const rawCapacity = serverCount * ssdCount * ssdSize * CONSTANTS.TB_TO_TIB;
  const performance = calculatePerformance(serverCount, ssdCount);
  return {
    serverCount, ssdCount, ecScheme, tolerance, ssdConfig: `${ssdCount} × ${ssdSize}TB NVMe SSD`, ssdSize,
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
    for (let servers = minServersForPerf; servers <= CONSTANTS.MAX_SERVERS; servers++) {
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
    ssdCount: CONSTANTS.SSDS_PER_SERVER,
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
