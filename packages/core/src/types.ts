export interface StorageSystem {
  name: string;
  minCapacity: string;
  maxCapacity: string;
  diskTypes: DiskType[];
  raidTypes: RAIDType[];
  features: string[];
}

export interface DiskType {
  type: 'SSD' | 'HDD' | 'NVMe';
  capacity: string;
  minCount: number;
  maxCount: number;
}

export interface RAIDType {
  type: 'RAID0' | 'RAID1' | 'RAID5' | 'RAID6' | 'RAID10';
  minDisks: number;
  dataDisks: number;
  parityDisks: number;
  efficiency: number;
}

export interface PlanRequest {
  storage: string;
  capacity: string;
  diskType?: string;
  raidType?: string;
  redundancy?: number;
}

export interface PlanResult {
  system: string;
  capacity: string;
  diskType: string;
  diskCapacity: string;
  diskCount: number;
  raidType: string;
  usableCapacity: string;
  efficiency: number;
  redundancy: number;
  summary: string;
}

export interface ParsedCapacity {
  value: number;
  unit: 'TB' | 'TiB' | 'PB' | 'PiB';
}
