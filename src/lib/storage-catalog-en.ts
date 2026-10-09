/**
 * storage-catalog 的英文版：结构与中文版逐项对应，改中文时记得同步这里。
 * AI 系统提示词仍只读中文版。
 */
import type { GuideRow, StorageKey } from './storage-catalog'

export const STORAGE_NAMES_EN: Record<StorageKey, string> = {
  vastdata: 'VastData (all-flash): unified file / object / block storage',
  'gpfs-ece': 'GPFS/Scale (all-flash): ECE parallel file system',
  'gpfs-hybrid': 'GPFS/Scale (hybrid): parallel file system with NVMe metadata tier + HDD data tier',
  weka: 'Weka (all-flash): parallel file system',
  xeos: 'XSKY XEOS (hybrid): object storage',
  ceph: 'Ceph (all-flash): unified block / object / file storage',
  'ceph-hybrid': 'Ceph (hybrid): object storage (RGW)',
}

export const SELECTION_GUIDE_EN: { title: string; rows: GuideRow[]; notes?: string[] }[] = [
  {
    title: 'High-performance file systems',
    rows: [
      {
        key: 'vastdata',
        name: 'VastData (all-flash)',
        pros: 'Multi-protocol, can replace Ceph; multi-tenancy, QoS and dedup; low build cost once licensing is amortized; vendor support',
        cons: 'Slightly slower than GPFS/Scale (all-flash); long procurement cycle',
        scenarios: 'Shared multi-tenant storage that needs QoS and vendor support',
      },
      {
        key: 'gpfs-ece',
        name: 'GPFS/Scale (all-flash)',
        pros: 'High performance, mature ecosystem, low licensing cost',
        cons: 'Weak multi-tenancy; relies on third-party vendor support',
        scenarios: 'Single-tenant high performance on a limited budget',
      },
      {
        key: 'gpfs-hybrid',
        name: 'GPFS/Scale (hybrid)',
        pros: 'Far lower cost per TB than all-flash; large-block bandwidth scales with HDD count; same operations stack as GPFS/Scale (all-flash)',
        cons: 'Small-file random performance depends on NVMe tier hit rate; slow HDD rebuilds; weak multi-tenancy',
        scenarios: 'Large warm/cold datasets, mostly large sequential I/O',
      },
      {
        key: 'weka',
        name: 'Weka (all-flash)',
        pros: 'Faster than GPFS/Scale (all-flash); multi-tenancy',
        cons: 'High licensing cost; relies on third-party vendor support',
        scenarios: 'Maximum performance with an ample budget',
      },
      {
        key: 'ceph',
        name: 'CephFS (all-flash)',
        pros: 'Open source, no licensing cost; multi-tenancy',
        cons: 'No QoS; metadata cache bound by node memory, performance collapses when memory runs short; high operating cost; no vendor support',
        scenarios: 'Budget general-purpose shared file storage (non-AI)',
      },
    ],
    notes: ['CephFS is not recommended for AI workloads'],
  },
  {
    title: 'Object storage',
    rows: [
      {
        key: 'xeos',
        name: 'XSKY XEOS (hybrid)',
        pros: 'Feature-complete and stable; scales out with QoS; vendor support',
        cons: 'High licensing cost',
        scenarios: 'Production workloads that value stability and vendor support',
      },
      {
        key: 'ceph-hybrid',
        name: 'Ceph RGW (hybrid)',
        pros: 'Open source, no licensing cost',
        cons: 'Less stable than XSKY XEOS; weak QoS; unproven at massive object counts; no vendor support',
        scenarios: 'Limited budget, non-critical workloads',
      },
      {
        key: 'vastdata',
        name: 'VastData S3 (all-flash)',
        pros: 'High performance; can share a cluster with the file system; QoS and scale-out; vendor support',
        cons: 'All-flash is costly, only worth it for high-performance use',
        scenarios: 'High-performance object storage',
      },
    ],
  },
  {
    title: 'Block storage',
    rows: [
      {
        key: 'vastdata',
        name: 'VastData Block (all-flash)',
        pros: 'High performance, vendor support',
        cons: 'No QoS in the current release',
        scenarios: 'High-performance block storage, comfortable with a newer product',
      },
      {
        key: 'ceph',
        name: 'Ceph RBD (all-flash)',
        pros: 'Open source, no licensing cost; mature block storage',
        cons: 'Mediocre all-flash performance; no vendor support',
        scenarios: 'Budget general-purpose block storage for VMs and databases',
      },
    ],
  },
]

type StorageInfo = { description: string; pros: string[]; cons: string[]; limits?: string[] }

export const STORAGE_INFO_EN: Record<StorageKey, StorageInfo> = {
  xeos: {
    description: 'XSKY XEOS is a distributed object storage system that pairs many HDDs with a few NVMe SSDs in a hybrid architecture, suited to massive unstructured data.',
    pros: ['Very large clusters', 'QoS', 'Stable and reliable', 'CRC64 checksums', 'Vendor support'],
    cons: ['High licensing cost', 'Somewhat lower usable ratio, higher overall cost'],
  },
  vastdata: {
    description: 'VastData is an all-flash unified storage platform built on NVMe SSD and SCM, serving file, object and block from one system.',
    pros: ['Multi-protocol, can replace Ceph', 'Multi-tenancy', 'Dedup and compression increase usable capacity', 'QoS (including metadata QoS)', 'Vendor support'],
    cons: ['More expensive to buy than GPFS', 'High-capacity QLC drives are slower than the small TLC drives used by GPFS and others', 'Long procurement cycle'],
  },
  'gpfs-ece': {
    description: 'IBM GPFS/Scale ECE (Erasure Coding Edition) is a high-performance parallel file system built on NVMe SSD and RDMA networking.',
    pros: ['High performance', 'Low purchase cost'],
    cons: ['Weak multi-tenancy', 'High operating cost', 'Weak vendor support'],
    limits: ['With multi-tenancy enabled, both the minimum capacity and the expansion step are 50 TiB', 'With multi-tenancy enabled, K8s supports hostPath only, not CSI-based PVCs'],
  },
  'gpfs-hybrid': {
    description: 'GPFS/Scale (hybrid) is mostly high-capacity HDD with a small NVMe SSD tier: metadata and hot data live on NVMe, cold data on HDD — a large parallel file system at far below all-flash cost.',
    pros: [
      'Far lower cost per TB than all-flash',
      'With tiering on, hot data hits NVMe: about 1.5–2× the bandwidth of pure HDD and 8×+ the IOPS',
      'Large sequential bandwidth scales linearly with HDD spindle count',
      'Same software and operations as GPFS/Scale (all-flash); pools can be mixed and tiered',
    ],
    cons: [
      'Performance depends heavily on NVMe hit rate; a low hit rate falls back to HDD levels (IOPS gap near 10×)',
      'Long HDD rebuilds with a clear performance drop meanwhile',
      'Weak multi-tenancy, high operating cost, weak vendor support',
    ],
    limits: [
      'Performance baseline from a 10-node Inspur AS13000 + GPFS 5.2.3.2 test (4+2P pool, 100G IB), extrapolated linearly by HDD and NVMe count; validate at larger scale',
      'Not recommended for AI training dominated by small random I/O — choose all-flash there',
      'Usable capacity counts only the HDD data tier; the NVMe tier is metadata and hot-data cache',
      'Per-node NVMe raw capacity must be at least 5% of per-node HDD raw capacity, 10% recommended; with the 4 × 15.36TB cap, large HDD configs (e.g. 36 × 24TB) top out around 7%',
    ],
  },
  ceph: {
    description: 'Ceph is an open-source distributed unified storage system. This is an all-flash configuration serving block, object and file from one cluster.',
    pros: [
      'Open source, no software licensing',
      'Multi-tenancy',
      'Unified storage: block, object and file',
      'Mature block storage',
      'Mixed disk capacities within one cluster',
    ],
    cons: [
      'No folded erasure coding, so the usable ratio is low with few nodes',
      'Poor per-disk balance further reduces usable capacity, usually counted at 70%',
      'Mediocre all-flash performance; high-performance use needs more disks',
      'File system metadata cache is bound by node memory; performance collapses when it runs short',
      'File system metadata needs several extra large-memory nodes',
      'High file system operating cost',
      'CephFS has no QoS; Ceph RGW QoS is weak',
      'No vendor support',
    ],
    limits: [
      'Keep hot files in the file system under 50 million (about 200GB of memory)',
      'File system is not recommended for AI workloads',
    ],
  },
  'ceph-hybrid': {
    description: 'Ceph (hybrid) is mostly high-capacity HDD with NVMe SSD as the index tier; in hybrid form it is only recommended as object storage (Ceph RGW), for low-cost massive unstructured data.',
    pros: [
      'Open source, no software licensing',
      'Multi-tenancy',
      'Low hardware cost with high-capacity HDD',
      'Mixed disk capacities within one cluster',
    ],
    cons: [
      'No folded erasure coding, so the usable ratio is low with few nodes',
      'Poor per-disk balance further reduces usable capacity, usually counted at 70%',
      'Ceph RGW QoS is weak',
      'No vendor support',
    ],
    limits: [
      'Hybrid configs are only recommended as object storage (Ceph RGW), not for block or file',
    ],
  },
  weka: {
    description: 'Weka (WekaFS) is an all-flash parallel file system built on NVMe SSD and fast networking, for AI / HPC and other high-performance workloads.',
    pros: ['Highest performance in its class', 'Tiers to object storage for a low-cost hybrid file system', 'Multi-tenancy', 'QoS'],
    cons: ['High licensing cost', 'Relies on third-party vendor support'],
    limits: ['Stripe width D+P must be 5–20, and D must be greater than P'],
  },
}
