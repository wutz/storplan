/**
 * 容量与带宽的单位解析和格式化，各规划器共用。
 * 内部统一以 TiB 计量容量、以 MiB/s 计量带宽，只在解析输入和格式化结果时换算。
 */
export const TB_TO_TIB = 0.909;
export const MIBS_TO_MBPS = 8.388608;
// 1 MiB/s = 1.048576 MB/s（MB/GB 按 1000 进制换算）
export const MIB_TO_MB = 1.048576;

export function parseCapacity(input: string): { tib: number; unit: string; isBinary: boolean } {
  const match = input.match(/^([\d.]+)\s*(TB|PB|TiB|PiB)$/i);
  if (!match) {
    throw new Error(`容量格式不正确：${input}。请使用形如 "500TB" 或 "1.5PiB" 的写法。`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const isBinary = unit.endsWith('IB');

  let tib: number;
  switch (unit) {
    case 'TB': tib = value * TB_TO_TIB; break;
    case 'PB': tib = value * 1000 * TB_TO_TIB; break;
    case 'TIB': tib = value; break;
    case 'PIB': tib = value * 1024; break;
    default: throw new Error(`不支持的单位：${unit}`);
  }

  return { tib, unit, isBinary };
}

export function parseBandwidth(input: string): { mibps: number; unit: string; unitType: string } {
  const match = input.match(/^([\d.]+)\s*(MB\/s|GB\/s|MiB\/s|GiB\/s|Mbps|Gbps)$/i);
  if (!match) {
    throw new Error(`带宽格式不正确：${input}。请使用形如 "100MB/s"、"1GiB/s"、"800Mbps" 或 "10Gbps" 的写法。`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];
  const unitLower = unit.toLowerCase();

  let mibps: number;
  let unitType: string;

  if (unitLower === 'mb/s') { mibps = value / MIB_TO_MB; unitType = 'decimal-byte'; }
  else if (unitLower === 'gb/s') { mibps = value * 1000 / MIB_TO_MB; unitType = 'decimal-byte'; }
  else if (unitLower === 'mib/s') { mibps = value; unitType = 'binary'; }
  else if (unitLower === 'gib/s') { mibps = value * 1024; unitType = 'binary'; }
  else if (unitLower === 'mbps') { mibps = value / MIBS_TO_MBPS; unitType = 'decimal-bit'; }
  else if (unitLower === 'gbps') { mibps = value * 1000 / MIBS_TO_MBPS; unitType = 'decimal-bit'; }
  else { throw new Error(`不支持的带宽单位：${unit}`); }

  return { mibps, unit, unitType };
}

export function formatCapacity(tib: number, preferBinary = true): string {
  if (preferBinary) {
    if (tib >= 1024) return `${(tib / 1024).toFixed(2)} PiB`;
    return `${tib.toFixed(2)} TiB`;
  }
  const tb = tib / TB_TO_TIB;
  if (tb >= 1000) return `${(tb / 1000).toFixed(2)} PB`;
  return `${tb.toFixed(2)} TB`;
}

export function formatBandwidth(mibps: number, unitType = 'decimal-bit'): string {
  if (unitType === 'binary') {
    if (mibps >= 1024) return `${(mibps / 1024).toFixed(2)} GiB/s`;
    return `${mibps.toFixed(2)} MiB/s`;
  } else if (unitType === 'decimal-byte') {
    const mbs = mibps * MIB_TO_MB;
    if (mbs >= 1000) return `${(mbs / 1000).toFixed(2)} GB/s`;
    return `${mbs.toFixed(2)} MB/s`;
  } else {
    const mbps = mibps * MIBS_TO_MBPS;
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
    return `${mbps.toFixed(2)} Mbps`;
  }
}
