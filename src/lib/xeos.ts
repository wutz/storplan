import { parseCapacity, parseBandwidth, formatCapacity, formatBandwidth } from './utils';

export interface XEOSPlanRequest {
  capacity: string;
  uploadBandwidth?: string;
  downloadBandwidth?: string;
  uploadOps?: number;
  downloadOps?: number;
}

export interface XEOSPlanResult {
  serverCount: number;
  ecScheme: string;
  tolerance: number;
  diskSize: number;
  actualCapacity: number;
  rawCapacity: number;
  performance: {
    uploadBandwidth: number;
    downloadBandwidth: number;
    uploadOps: number;
    downloadOps: number;
  };
  formatted: {
    capacity: string;
    rawCapacity: string;
    uploadBandwidth: string;
    downloadBandwidth: string;
    uploadOps: string;
    downloadOps: string;
  };
  capacityUnitPreference: boolean;
  bandwidthUnitType: string;
}

export const CONSTANTS = {
  DISKS_PER_SERVER: 32,
  SPACE_OVERHEAD: 0.81,
  EC8_2_EFFICIENCY: 0.8,
  EC4_2_EFFICIENCY: 0.6667,
  UPLOAD_BW_PER_DISK: 30,
  DOWNLOAD_BW_PER_DISK: 60,
  UPLOAD_OPS_PER_DISK: 100,
  DOWNLOAD_OPS_PER_DISK: 300,
  DISK_SIZES: [24, 22, 20, 18, 16, 12, 10, 8] as const,
  TB_TO_TIB: 0.909,
};

export const EC_SCHEMES = [
  { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1, minServers: 3 },
  { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1, minServers: 5 },
  { scheme: 'EC4+2', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 2, minServers: 6 },
  { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2, minServers: 10 },
] as const;

export function getAllowedEcSchemes(serverCount: number) {
  if (serverCount <= 4) {
    // 3-4 nodes: only EC4+2:1
    return [EC_SCHEMES[0]]; // EC4+2:1
  }
  if (serverCount <= 9) {
    // 5-9 nodes: EC8+2:1 (default) and EC4+2
    return [EC_SCHEMES[1], EC_SCHEMES[2]]; // EC8+2:1, EC4+2
  }
  // 10+ nodes: EC8+2 (default) and EC4+2
  return [EC_SCHEMES[3], EC_SCHEMES[2]]; // EC8+2, EC4+2
}

export function calculateCapacityTiB(serverCount: number, diskSizeTB: number, ecEfficiency: number): number {
  return serverCount * CONSTANTS.DISKS_PER_SERVER * diskSizeTB * CONSTANTS.TB_TO_TIB * CONSTANTS.SPACE_OVERHEAD * ecEfficiency;
}

interface ECScheme {
  scheme: string;
  efficiency: number;
  tolerance: number;
}

export function getEcScheme(serverCount: number): ECScheme {
  if (serverCount <= 4) return { scheme: 'EC4+2:1', efficiency: CONSTANTS.EC4_2_EFFICIENCY, tolerance: 1 };
  if (serverCount <= 9) return { scheme: 'EC8+2:1', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 1 };
  return { scheme: 'EC8+2', efficiency: CONSTANTS.EC8_2_EFFICIENCY, tolerance: 2 };
}

function calculateActualCapacity(serverCount: number, diskSizeTB: number, efficiency: number): number {
  const diskSizeTiB = diskSizeTB * CONSTANTS.TB_TO_TIB;
  return serverCount * CONSTANTS.DISKS_PER_SERVER * diskSizeTiB * CONSTANTS.SPACE_OVERHEAD * efficiency;
}

function calculateRawCapacity(serverCount: number, diskSizeTB: number): number {
  return serverCount * CONSTANTS.DISKS_PER_SERVER * diskSizeTB * CONSTANTS.TB_TO_TIB;
}

function calculatePerformance(serverCount: number) {
  const totalDisks = serverCount * CONSTANTS.DISKS_PER_SERVER;
  return {
    uploadBandwidth: totalDisks * CONSTANTS.UPLOAD_BW_PER_DISK,
    downloadBandwidth: totalDisks * CONSTANTS.DOWNLOAD_BW_PER_DISK,
    uploadOps: totalDisks * CONSTANTS.UPLOAD_OPS_PER_DISK,
    downloadOps: totalDisks * CONSTANTS.DOWNLOAD_OPS_PER_DISK,
  };
}

function calculateMinServersForPerf(perfReq: { uploadBw?: number; downloadBw?: number; uploadOps?: number; downloadOps?: number }): number {
  const needs = [
    perfReq.uploadBw ? perfReq.uploadBw / CONSTANTS.UPLOAD_BW_PER_DISK : 0,
    perfReq.downloadBw ? perfReq.downloadBw / CONSTANTS.DOWNLOAD_BW_PER_DISK : 0,
    perfReq.uploadOps ? perfReq.uploadOps / CONSTANTS.UPLOAD_OPS_PER_DISK : 0,
    perfReq.downloadOps ? perfReq.downloadOps / CONSTANTS.DOWNLOAD_OPS_PER_DISK : 0,
  ];
  const maxDisks = Math.max(...needs);
  if (maxDisks === 0) return 0;
  return Math.ceil(maxDisks / CONSTANTS.DISKS_PER_SERVER);
}

function scoreConfig(serverCount: number, ecEfficiency: number, actualCapacity: number, requiredCapacity: number): number {
  const overProvisionRatio = actualCapacity / requiredCapacity;
  return serverCount * 1000 + (1 - ecEfficiency) * 100 + overProvisionRatio;
}

export function buildXEOSResult(
  serverCount: number,
  diskSize: number,
  ecScheme: string,
  ecEfficiency: number,
  tolerance: number,
  isBinary: boolean,
  bandwidthUnitType: string
): XEOSPlanResult {
  const actualCapacity = calculateActualCapacity(serverCount, diskSize, ecEfficiency);
  const rawCapacity = calculateRawCapacity(serverCount, diskSize);
  const performance = calculatePerformance(serverCount);
  return {
    serverCount, ecScheme, tolerance, diskSize, actualCapacity, rawCapacity, performance,
    formatted: {
      capacity: formatCapacity(actualCapacity, isBinary),
      rawCapacity: formatCapacity(rawCapacity, isBinary),
      uploadBandwidth: formatBandwidth(performance.uploadBandwidth, bandwidthUnitType),
      downloadBandwidth: formatBandwidth(performance.downloadBandwidth, bandwidthUnitType),
      uploadOps: `${performance.uploadOps.toLocaleString()}`,
      downloadOps: `${performance.downloadOps.toLocaleString()}`,
    },
    capacityUnitPreference: isBinary,
    bandwidthUnitType,
  };
}

export function planXEOS(req: XEOSPlanRequest): XEOSPlanResult {
  const capacityInfo = parseCapacity(req.capacity);
  const capacityTiB = capacityInfo.tib;

  const perfReq: { uploadBw?: number; downloadBw?: number; uploadOps?: number; downloadOps?: number } = {};
  let bandwidthUnitType: string | null = null;

  if (req.uploadBandwidth) {
    const bwInfo = parseBandwidth(req.uploadBandwidth);
    perfReq.uploadBw = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (req.downloadBandwidth) {
    const bwInfo = parseBandwidth(req.downloadBandwidth);
    perfReq.downloadBw = bwInfo.mibps;
    bandwidthUnitType = bandwidthUnitType || bwInfo.unitType;
  }
  if (req.uploadOps) perfReq.uploadOps = req.uploadOps;
  if (req.downloadOps) perfReq.downloadOps = req.downloadOps;

  if (bandwidthUnitType === null) bandwidthUnitType = 'decimal-bit';

  const minServersForPerf = calculateMinServersForPerf(perfReq);

  interface Config {
    serverCount: number;
    diskSize: number;
    ecScheme: string;
    ecEfficiency: number;
    tolerance: number;
    actualCapacity: number;
  }

  const configs: Config[] = [];

  const startServers = Math.max(3, minServersForPerf);

  for (const diskSize of CONSTANTS.DISK_SIZES) {
    for (let servers = startServers; servers <= 200; servers++) {
      const ec = getEcScheme(servers);
      const actual = calculateActualCapacity(servers, diskSize, ec.efficiency);

      if (actual >= capacityTiB) {
        configs.push({
          serverCount: servers,
          diskSize,
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

  const best = configs.reduce((a, b) =>
    scoreConfig(a.serverCount, a.ecEfficiency, a.actualCapacity, capacityTiB) <=
    scoreConfig(b.serverCount, b.ecEfficiency, b.actualCapacity, capacityTiB) ? a : b
  );

  const performance = calculatePerformance(best.serverCount);
  const rawCapacity = calculateRawCapacity(best.serverCount, best.diskSize);

  return {
    serverCount: best.serverCount,
    ecScheme: best.ecScheme,
    tolerance: best.tolerance,
    diskSize: best.diskSize,
    actualCapacity: best.actualCapacity,
    rawCapacity,
    performance,
    formatted: {
      capacity: formatCapacity(best.actualCapacity, capacityInfo.isBinary),
      rawCapacity: formatCapacity(rawCapacity, capacityInfo.isBinary),
      uploadBandwidth: formatBandwidth(performance.uploadBandwidth, bandwidthUnitType),
      downloadBandwidth: formatBandwidth(performance.downloadBandwidth, bandwidthUnitType),
      uploadOps: `${performance.uploadOps.toLocaleString()}`,
      downloadOps: `${performance.downloadOps.toLocaleString()}`,
    },
    capacityUnitPreference: capacityInfo.isBinary,
    bandwidthUnitType,
  };
}
