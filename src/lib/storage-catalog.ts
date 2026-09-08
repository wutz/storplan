/**
 * 存储方案知识库：选型对比表，以及每个方案的说明、优势与限制。
 * 页面上的选型参考卡片、方案卡说明区和 AI 助手的系统提示词都读这一份数据，改一处两边同步。
 */

export const STORAGE_ORDER = ['vastdata', 'gpfs-ece', 'gpfs-hybrid', 'weka', 'xeos', 'ceph', 'ceph-hybrid'] as const

export type StorageKey = (typeof STORAGE_ORDER)[number]

/** 方案 key -> 供 AI 提示词使用的中文名称（页面展示名见 routes/index.tsx 的 THEME） */
export const STORAGE_NAMES: Record<StorageKey, string> = {
  vastdata: 'VastData（全闪统一存储：文件 / 对象 / 块）',
  'gpfs-ece': 'GPFS/Scale ECE（全闪并行文件系统）',
  'gpfs-hybrid': 'GPFS/Scale 混闪（NVMe 元数据层 + HDD 数据层的并行文件系统）',
  weka: 'Weka（全闪并行文件系统）',
  xeos: 'XSKY XEOS（混闪对象存储）',
  ceph: 'Ceph 全闪（块 / 对象 / 文件统一存储）',
  'ceph-hybrid': 'Ceph 混闪（对象存储 RGW）',
}

// 存储选型参考（迁移自 infra-skills / storage-planner-router）
export type GuideRow = {
  key?: string // 对应本工具中的方案 key，可点击选择
  name: string
  pros: string
  cons: string
  scenarios: string
}

export const SELECTION_GUIDE: { title: string; rows: GuideRow[]; notes?: string[] }[] = [
  {
    title: '高性能文件系统',
    rows: [
      {
        key: 'vastdata',
        name: 'VastData',
        pros: '支持多种存储协议，可替代 Ceph；支持多租户、QoS 与去重；授权费用摊薄后建设成本低；有原厂技术支持',
        cons: '性能略低于 GPFS ECE，采购周期较长',
        scenarios: '多租户场景，需要 QoS 与技术支持',
      },
      {
        key: 'gpfs-ece',
        name: 'GPFS ECE',
        pros: '性能高、生态成熟，软件授权费用低',
        cons: '多租户支持较弱，依赖第三方厂商技术支持',
        scenarios: '单租户高性能场景，预算有限',
      },
      {
        key: 'gpfs-hybrid',
        name: 'GPFS 混闪',
        pros: '每 TB 成本远低于全闪；大块带宽随 HDD 数量线性增长；与全闪 GPFS 共用同一套运维体系',
        cons: '小文件随机性能依赖 NVMe 层命中率；HDD 重建慢；多租户支持较弱',
        scenarios: '大容量冷温数据，以大文件顺序读写为主的场景',
      },
      {
        key: 'weka',
        name: 'Weka',
        pros: '性能高于 GPFS ECE；支持多租户',
        cons: '软件授权费用高，依赖第三方厂商技术支持',
        scenarios: '追求极致性能，预算充足',
      },
      {
        key: 'ceph',
        name: 'CephFS',
        pros: '开源，无软件授权费用；支持多租户',
        cons: '不支持 QoS；元数据缓存受节点内存限制，内存不足时性能锐减；运维成本高；无原厂技术支持',
        scenarios: '预算有限、非 AI 场景的通用共享文件存储',
      },
    ],
    notes: ['CephFS 不建议应用于 AI 场景'],
  },
  {
    title: '对象存储',
    rows: [
      {
        key: 'xeos',
        name: 'XSKY XEOS',
        pros: '功能齐全、稳定；支持大规模扩展与 QoS；有原厂技术支持',
        cons: '软件授权费用高',
        scenarios: '生产环境，需要稳定性与技术支持',
      },
      {
        key: 'ceph-hybrid',
        name: 'Ceph RGW',
        pros: '开源，无软件授权费用',
        cons: '稳定性不及 XSKY XEOS；QoS 较弱；海量对象场景尚未充分验证；无原厂技术支持',
        scenarios: '预算有限、非关键业务',
      },
      {
        key: 'vastdata',
        name: 'VastData S3',
        pros: '性能高；可与文件系统共用同一集群；支持 QoS 与大规模扩展；有原厂技术支持',
        cons: '全闪架构成本较高，只适合高性能场景',
        scenarios: '高性能对象存储需求',
      },
    ],
  },
  {
    title: '块存储',
    rows: [
      {
        key: 'vastdata',
        name: 'VastData Block',
        pros: '性能高，有原厂技术支持',
        cons: '当前版本暂不支持 QoS',
        scenarios: '高性能块存储需求，可接受新产品',
      },
      {
        key: 'ceph',
        name: 'Ceph RBD',
        pros: '开源，无软件授权费用；块存储方案成熟',
        cons: '全闪配置性能一般，无原厂技术支持',
        scenarios: '预算有限的虚拟机、数据库等通用块存储',
      },
    ],
  },
]

export const STORAGE_INFO: Record<StorageKey, { description: string; pros: string[]; cons: string[]; limits?: string[] }> = {
  xeos: {
    description: 'XSKY XEOS 是分布式对象存储系统，以大量 HDD 搭配少量 NVMe SSD 组成混闪架构，适合存放海量非结构化数据。',
    pros: ['支持超大规模集群', '支持 QoS', '稳定可靠', '支持 CRC64 校验', '有原厂技术支持'],
    cons: ['软件授权费用较高', '得盘率稍低，整体成本偏高'],
  },
  vastdata: {
    description: 'VastData 是基于 NVMe SSD 和 SCM 的全闪统一存储平台，一套系统同时提供文件、对象和块存储服务。',
    pros: ['支持多种存储协议，可替代 Ceph', '支持多租户', '去重与压缩可提升集群可用容量', '支持 QoS（含元数据 QoS）', '有原厂技术支持'],
    cons: ['采购费用高于 GPFS', '采用 QLC 大容量盘，性能低于 GPFS 等使用 TLC 小容量盘的方案', '采购周期较长'],
  },
  'gpfs-ece': {
    description: 'IBM GPFS/Scale ECE（Erasure Coding Edition）是基于 NVMe SSD 和 RDMA 网络的高性能并行文件系统。',
    pros: ['性能高', '采购成本低'],
    cons: ['多租户支持较弱', '运维成本高', '原厂技术支持较弱'],
    limits: ['启用多租户时，容量起步与扩容步长均为 50 TiB', '启用多租户时，K8s 仅支持 hostPath，不支持基于 CSI 的 PVC'],
  },
  'gpfs-hybrid': {
    description: 'GPFS/Scale 混闪以大容量 HDD 为主、少量 NVMe SSD 为辅：元数据与热数据放在 NVMe 层，冷数据落在 HDD 层，用远低于全闪的成本换来大容量并行文件系统。',
    pros: [
      '每 TB 成本远低于全闪方案',
      '开启分层后热数据命中 NVMe，带宽约为纯 HDD 的 1.5–2 倍，IOPS 可达 8 倍以上',
      '大块顺序读写带宽随 HDD 主轴数线性增长',
      '与全闪 GPFS 共用同一套软件与运维体系，可混合组池分层',
    ],
    cons: [
      '性能强依赖 NVMe 层命中率，命中率低时会回落到 HDD 水平（IOPS 差距接近一个数量级）',
      'HDD 重建时间长，重建期间性能下降明显',
      '多租户支持较弱，运维成本高，原厂技术支持较弱',
    ],
    limits: [
      '性能基准来自浪潮 AS13000 + GPFS 5.2.3.2 十节点实测（存储池 4+2P、100G IB），按 HDD 与 NVMe 数量线性外推，规模较大时需实测复核',
      '不建议用于以小文件随机读写为主的 AI 训练场景，这类场景应选全闪方案',
      '可用容量只统计 HDD 数据层，NVMe 层按元数据与热数据缓存计',
      '单节点 NVMe 裸容量不低于单节点 HDD 裸容量的 5%，推荐 10%；受 4 盘 × 15.36TB 的选型上限所限，大容量 HDD 配置（如 36 × 24TB）最高只能配到约 7%',
    ],
  },
  ceph: {
    description: 'Ceph 是开源分布式统一存储系统。本方案为全闪配置，一套集群同时提供块、对象和文件存储服务。',
    pros: [
      '开源软件，无需购买软件授权',
      '支持多租户',
      '统一存储：同时提供块、对象与文件服务',
      '块存储系统成熟',
      '支持同一集群使用不同容量磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '每盘容量均衡度低，总可用容量进一步缩减，通常按 70% 计算',
      '全闪性能一般，高性能场景需要增加磁盘数量',
      '文件系统元数据缓存受节点内存限制，内存不足时性能锐减',
      '文件系统元数据需额外配置多个大内存节点',
      '文件系统运维成本高',
      'CephFS 不支持 QoS，Ceph RGW 的 QoS 较弱',
      '无原厂技术支持',
    ],
    limits: [
      '文件系统热数据文件数建议不超过 5000 万个（约需 200GB 内存）',
      '文件系统不建议应用于 AI 场景',
    ],
  },
  'ceph-hybrid': {
    description: 'Ceph 混闪以大容量 HDD 为主，NVMe SSD 作索引层；混闪形态下只建议配置为对象存储（Ceph RGW），适合低成本存放海量非结构化数据。',
    pros: [
      '开源软件，无需购买软件授权',
      '支持多租户',
      '大容量 HDD 硬件成本低',
      '支持同一集群使用不同容量磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '每盘容量均衡度低，总可用容量进一步缩减，通常按 70% 计算',
      'Ceph RGW 的 QoS 较弱',
      '无原厂技术支持',
    ],
    limits: [
      '混闪配置只建议用作对象存储（Ceph RGW），不建议配置块存储和文件系统',
    ],
  },
  weka: {
    description: 'Weka（WekaFS）是基于 NVMe SSD 和高速网络的全闪并行文件系统，适合 AI / HPC 等高性能场景。',
    pros: ['性能极高，是同类方案中最高的', '支持分层到对象存储，可构建低成本混闪文件系统', '支持多租户', '支持 QoS'],
    cons: ['软件授权费用较高', '依赖第三方厂商技术支持'],
    limits: ['条带宽度 D+P 限制在 5–20 之间，且 D 必须大于 P'],
  },
}
