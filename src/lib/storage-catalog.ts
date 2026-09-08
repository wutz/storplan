/**
 * 存储方案知识库：选型对比表 + 每个方案的说明 / 优劣 / 限制。
 * 页面（选型参考卡片、方案卡说明区）与 AI 规划助手的系统提示词共用这一份数据，避免两处描述漂移。
 */

export const STORAGE_ORDER = ['vastdata', 'gpfs-ece', 'gpfs-hybrid', 'weka', 'xeos', 'ceph', 'ceph-hybrid'] as const

export type StorageKey = (typeof STORAGE_ORDER)[number]

/** 方案 key -> 供 AI 提示词使用的中文名称（页面展示名见 routes/index.tsx 的 THEME） */
export const STORAGE_NAMES: Record<StorageKey, string> = {
  vastdata: 'VastData（全闪统一存储：文件 / 对象 / 块）',
  'gpfs-ece': 'GPFS/Scale ECE（全闪并行文件系统）',
  'gpfs-hybrid': 'GPFS/Scale 混闪（NVMe 元数据层 + HDD 数据层）',
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
        pros: '协议齐全，可替代 Ceph；支持多租户、QoS 和去重；授权摊薄后建设成本较低；有原厂支持',
        cons: '性能略低于 GPFS ECE，采购周期偏长',
        scenarios: '需要多租户、QoS 和原厂支持',
      },
      {
        key: 'gpfs-ece',
        name: 'GPFS ECE',
        pros: '性能高、生态成熟，软件授权费用低',
        cons: '多租户能力弱，要靠第三方技术支持',
        scenarios: '单租户、要高性能、预算有限',
      },
      {
        key: 'gpfs-hybrid',
        name: 'GPFS 混闪',
        pros: '每 TB 成本远低于全闪；大块带宽随 HDD 数量线性增长；与全闪 GPFS 同一套运维',
        cons: '小文件随机性能取决于 NVMe 层命中率，HDD 重建慢，多租户能力弱',
        scenarios: '大容量冷温数据，以大文件顺序读写为主',
      },
      {
        key: 'weka',
        name: 'Weka',
        pros: '性能高于 GPFS ECE，支持多租户',
        cons: '软件授权贵，要靠第三方技术支持',
        scenarios: '要极致性能、预算充足',
      },
      {
        key: 'ceph',
        name: 'CephFS',
        pros: '开源、没有软件授权费用，支持多租户',
        cons: '不支持 QoS；元数据缓存受节点内存限制，内存不够时性能会明显下降；运维成本高，没有原厂支持',
        scenarios: '预算有限、非 AI 场景的通用共享文件存储',
      },
    ],
    notes: ['CephFS 不适合用在 AI 场景'],
  },
  {
    title: '对象存储',
    rows: [
      {
        key: 'xeos',
        name: 'XSKY XEOS',
        pros: '功能齐全、运行稳定，支持大规模扩展和 QoS，有原厂支持',
        cons: '软件授权费用高',
        scenarios: '生产环境，看重稳定性和原厂支持',
      },
      {
        key: 'ceph-hybrid',
        name: 'Ceph RGW',
        pros: '开源、没有软件授权费用',
        cons: '稳定性不如 XSKY XEOS，QoS 较弱，海量对象场景验证不足，没有原厂支持',
        scenarios: '预算有限的非关键业务',
      },
      {
        key: 'vastdata',
        name: 'VastData S3',
        pros: '性能高，可与文件系统共用同一集群，支持 QoS 和大规模扩展，有原厂支持',
        cons: '全闪架构成本较高，更适合高性能场景',
        scenarios: '需要高性能对象存储',
      },
    ],
  },
  {
    title: '块存储',
    rows: [
      {
        key: 'vastdata',
        name: 'VastData Block',
        pros: '性能高，有原厂支持',
        cons: '当前版本暂不支持 QoS',
        scenarios: '需要高性能块存储，且能接受较新产品',
      },
      {
        key: 'ceph',
        name: 'Ceph RBD',
        pros: '开源、没有软件授权费用，块存储方案成熟',
        cons: '全闪配置性能一般，没有原厂支持',
        scenarios: '预算有限的虚拟机、数据库等通用块存储',
      },
    ],
  },
]

export const STORAGE_INFO: Record<StorageKey, { description: string; pros: string[]; cons: string[]; limits?: string[] }> = {
  xeos: {
    description: 'XSKY XEOS 是混闪对象存储：数据主要落在大量 HDD 上，少量 NVMe SSD 做加速，适合存放海量非结构化数据。',
    pros: ['可扩展到超大规模集群', '支持 QoS', '稳定可靠', '支持 CRC64 校验', '有原厂技术支持'],
    cons: ['软件授权较贵', '得盘率略低，整体成本偏高'],
  },
  vastdata: {
    description: 'VastData 是全闪统一存储：一套系统同时提供文件、对象和块服务，底层由 NVMe SSD 与 SCM 构成。',
    pros: ['多种存储协议，可替代 Ceph', '支持多租户', '去重与压缩能提高可用容量', '支持 QoS（含元数据 QoS）', '有原厂技术支持'],
    cons: ['采购费用高于 GPFS', '采用 QLC 大盘，性能低于用 TLC 小盘的 GPFS 等方案', '采购周期偏长'],
  },
  'gpfs-ece': {
    description: 'IBM GPFS/Scale ECE（Erasure Coding Edition）是全闪并行文件系统，基于 NVMe SSD 和 RDMA 网络，面向高性能场景。',
    pros: ['性能高', '采购成本低'],
    cons: ['多租户能力弱', '运维成本高', '原厂支持弱'],
    limits: ['启用多租户时，容量起步和扩容步长都是 50 TiB', '启用多租户时，K8s 只支持 hostPath，不支持基于 CSI 的 PVC'],
  },
  'gpfs-hybrid': {
    description: 'GPFS/Scale 混闪用大量大容量 HDD 加少量 NVMe SSD 组集群：元数据和热数据放在 NVMe 层，冷数据落在 HDD 层，用远低于全闪的成本换来大容量并行文件系统。',
    pros: [
      '每 TB 成本远低于全闪方案',
      '开启分层后，热数据命中 NVMe 时带宽约为纯 HDD 的 1.5–2 倍，IOPS 可达 8 倍以上',
      '大块顺序读写的带宽随 HDD 主轴数线性增长',
      '与全闪 GPFS 共用同一套软件和运维，也可以混合组池、分层',
    ],
    cons: [
      '性能很大程度上取决于 NVMe 层命中率，命中率低时会回到 HDD 水平（IOPS 可能差近一个数量级）',
      'HDD 重建时间长，重建期间性能会明显下降',
      '多租户能力弱，运维成本高，原厂支持也弱',
    ],
    limits: [
      '性能基准来自浪潮 AS13000 + GPFS 5.2.3.2 十节点实测（存储池 4+2P、100G IB），再按 HDD 与 NVMe 数量线性外推；大规模集群需要实测复核',
      '不适合以小文件随机读写为主的 AI 训练，这类场景应选全闪方案',
      '可用容量只统计 HDD 数据层，NVMe 层按元数据和热数据缓存计',
      '单节点 NVMe 裸容量不低于单节点 HDD 裸容量的 5%，推荐 10%；受 4 盘 × 15.36TB 的选型上限所限，大容量 HDD 配置（如 36 × 24TB）最高只能配到约 7%',
    ],
  },
  ceph: {
    description: '本方案是 Ceph 的全闪配置：开源分布式统一存储，一套集群同时提供块、对象和文件服务。',
    pros: [
      '开源软件，不用买软件授权',
      '支持多租户',
      '统一存储：同时提供块、对象和文件服务',
      '块存储方案成熟',
      '同一集群可以使用不同容量的磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '各盘容量不易均衡，总可用容量还要再打折，通常按 70% 计算',
      '全闪性能一般，高性能需求下需要加盘',
      '文件系统元数据缓存受节点内存限制，内存不够时性能会明显下降',
      '文件系统元数据还要额外配多台大内存节点',
      '文件系统运维成本高',
      'CephFS 不支持 QoS，Ceph RGW 的 QoS 也较弱',
      '没有原厂技术支持',
    ],
    limits: [
      '文件系统热数据量建议不超过 5000 万（大约需要 200GB 内存）',
      '文件系统不适合用在 AI 场景',
    ],
  },
  'ceph-hybrid': {
    description: 'Ceph 混闪用大量 HDD 加少量 NVMe SSD 组集群，只建议用作对象存储（Ceph RGW），适合低成本存放海量非结构化数据。',
    pros: [
      '开源软件，不用买软件授权',
      '支持多租户',
      '大容量 HDD 硬件成本低',
      '同一集群可以使用不同容量的磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '各盘容量不易均衡，总可用容量还要再打折，通常按 70% 计算',
      'Ceph RGW 的 QoS 较弱',
      '没有原厂技术支持',
    ],
    limits: [
      '混闪配置只建议用作对象存储（Ceph RGW），不建议再配块存储或文件系统',
    ],
  },
  weka: {
    description: 'Weka（WekaFS）是全闪并行文件系统，基于 NVMe SSD 与高速网络，面向 AI / HPC 等对性能要求很高的场景。',
    pros: ['性能极高，是同类方案里最高的', '支持分层到对象存储，做成低成本混闪文件系统', '支持多租户', '支持 QoS'],
    cons: ['软件授权费用较高', '技术支持来自第三方厂商'],
    limits: ['条带宽度 D+P 限制在 5–20 之间，且 D 必须大于 P'],
  },
}
