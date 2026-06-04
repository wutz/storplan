import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResult =
  | { type: 'xeos'; data: XEOSPlanResult }
  | { type: 'vastdata'; data: VastDataPlanResult }
  | { type: 'gpfs-ece'; data: GPFSECEPlanResult }

function StorplanApp() {
  const [storage, setStorage] = useState('xeos')
  const [capacityValue, setCapacityValue] = useState('')
  const [capacityUnit, setCapacityUnit] = useState('TiB')
  const [downloadBWValue, setDownloadBWValue] = useState('')
  const [downloadBWUnit, setDownloadBWUnit] = useState('GB/s')
  const [uploadBWValue, setUploadBWValue] = useState('')
  const [uploadBWUnit, setUploadBWUnit] = useState('GB/s')
  const [result, setResult] = useState<PlanResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!capacityValue && !downloadBWValue && !uploadBWValue) {
      setResult(null)
      setError('')
      return
    }

    try {
      const capacity = capacityValue ? `${capacityValue}${capacityUnit}` : `0${capacityUnit}`

      if (storage === 'xeos') {
        const uploadBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const downloadBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const plan = planXEOS({
          capacity,
          uploadBandwidth: uploadBW || undefined,
          downloadBandwidth: downloadBW || undefined,
        })
        setResult({ type: 'xeos', data: plan })
        setError('')
      } else if (storage === 'vastdata') {
        const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const plan = planVastData({
          capacity,
          readBandwidth: readBW || undefined,
          writeBandwidth: writeBW || undefined,
        })
        setResult({ type: 'vastdata', data: plan })
        setError('')
      } else if (storage === 'gpfs-ece') {
        const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const plan = planGPFSECE({
          capacity,
          readBandwidth: readBW || undefined,
          writeBandwidth: writeBW || undefined,
        })
        setResult({ type: 'gpfs-ece', data: plan })
        setError('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setResult(null)
    }
  }, [storage, capacityValue, capacityUnit, downloadBWValue, downloadBWUnit, uploadBWValue, uploadBWUnit])

  const bwLabels = storage === 'xeos'
    ? { read: '下载 BW', write: '上传 BW' }
    : { read: '读 BW', write: '写 BW' }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Storplan</h1>
        <p className="text-gray-600 mb-8">存储容量和性能规划工具</p>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">存储方案</label>
              <select
                value={storage}
                onChange={(e) => { setStorage(e.target.value); setResult(null) }}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="xeos">XSKY XEOS（对象存储）</option>
                <option value="vastdata">VastData（统一存储）</option>
                <option value="gpfs-ece">GPFS ECE（文件系统）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">容量</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={capacityValue}
                  onChange={(e) => setCapacityValue(e.target.value)}
                  placeholder="500"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={capacityUnit}
                  onChange={(e) => setCapacityUnit(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="TiB">TiB</option>
                  <option value="TB">TB</option>
                  <option value="PiB">PiB</option>
                  <option value="PB">PB</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{bwLabels.read}</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={downloadBWValue}
                  onChange={(e) => setDownloadBWValue(e.target.value)}
                  placeholder="20"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={downloadBWUnit}
                  onChange={(e) => setDownloadBWUnit(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="MB/s">MB/s</option>
                  <option value="GB/s">GB/s</option>
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{bwLabels.write}</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={uploadBWValue}
                  onChange={(e) => setUploadBWValue(e.target.value)}
                  placeholder="10"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={uploadBWUnit}
                  onChange={(e) => setUploadBWUnit(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="MB/s">MB/s</option>
                  <option value="GB/s">GB/s</option>
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <StorageInfo storage={storage} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {result?.type === 'xeos' && <XEOSResult data={result.data} />}
        {result?.type === 'vastdata' && <VastDataResult data={result.data} />}
        {result?.type === 'gpfs-ece' && <GPFSECEResult data={result.data} />}
      </div>
    </div>
  )
}

const STORAGE_INFO: Record<string, { description: string; features: string[]; pros: string[]; cons: string[] }> = {
  xeos: {
    description: 'XSKY XEOS 是分布式对象存储系统，基于 HDD 构建大容量存储池，适合海量非结构化数据存储。',
    features: ['S3 兼容 API', '纠删码数据保护（EC4+2/EC8+2）', '多节点容错', '线性扩展容量和性能', '多站点复制'],
    pros: ['单位存储成本低（HDD）', '容量可线性扩展至 EB 级', '高可用设计，支持多节点故障'],
    cons: ['延迟较高（HDD 随机 IO 受限）', '不适合小文件频繁读写', '仅支持对象协议（S3）'],
  },
  vastdata: {
    description: 'VastData 是全闪统一存储平台，单一系统同时提供文件、对象和块存储服务，基于 NVMe SSD 和 SCM 构建。',
    features: ['统一协议（NFS/SMB/S3/iSCSI/NVMe-oF）', '全闪 NVMe 架构', 'EBox 线性扩展（11-250 台）', '全局去重和压缩', '无元数据瓶颈'],
    pros: ['超低延迟（全闪 + SCM 加速）', '统一存储池，协议灵活切换', '性能随节点线性增长'],
    cons: ['成本较高（全闪）', '最小起步 11 个 EBox', '国内技术支持资源有限'],
  },
  'gpfs-ece': {
    description: 'IBM GPFS ECE（Erasure Coding Edition）是高性能并行文件系统，基于 NVMe SSD 和 RDMA 网络构建。',
    features: ['POSIX 兼容并行文件系统', '纠删码保护（EC4+2P/EC8+2P/EC8+3P）', '800Gb RoCE/InfiniBand 网络', 'GPU 直连存储（GPUDirect Storage）', '多协议（NFS/SMB/对象网关）'],
    pros: ['极高顺序读写带宽', '低延迟 RDMA 访问', '适合 AI/HPC 大规模并行工作负载'],
    cons: ['硬件要求高（RDMA 网络）', '运维复杂度较高', '许可证成本较高'],
  },
}

function StorageInfo({ storage }: { storage: string }) {
  const info = STORAGE_INFO[storage]
  if (!info) return null

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-8">
      <p className="text-gray-600 mb-4">{info.description}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">功能特性</h3>
          <ul className="space-y-1 text-gray-600">
            {info.features.map((f, i) => <li key={i}>• {f}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-green-700 mb-2">优势</h3>
          <ul className="space-y-1 text-gray-600">
            {info.pros.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-orange-700 mb-2">局限</h3>
          <ul className="space-y-1 text-gray-600">
            {info.cons.map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}

function XEOSResult({ data }: { data: XEOSPlanResult }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">XSKY XEOS 规划方案</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">服务器台数</dt>
              <dd>{data.serverCount} 台</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">纠删码方案</dt>
              <dd>{data.ecScheme}（容忍 {data.tolerance} 节点离线）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">磁盘配置</dt>
              <dd>每台 32 × {data.diskSize}TB HDD</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">可用容量</h3>
          <p className="text-2xl font-bold text-blue-600">{data.formatted.capacity}</p>
        </div>
        <div className="md:col-span-2">
          <h3 className="font-semibold text-gray-700 mb-2">性能</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">上传 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.uploadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">下载 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.downloadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">上传 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.uploadOps}</dd>
            </div>
            <div>
              <dt className="text-gray-500">下载 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.downloadOps}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function VastDataResult({ data }: { data: VastDataPlanResult }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">VastData 统一存储规划方案</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">EBox 数量</dt>
              <dd>{data.eboxCount} 台</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">磁盘配置</dt>
              <dd>{data.diskConfig}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">容量</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">可用容量</dt>
              <dd className="text-xl font-bold text-blue-600">{data.formatted.capacity}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">裸容量</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
          </dl>
        </div>
        <div className="md:col-span-2">
          <h3 className="font-semibold text-gray-700 mb-2">性能</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">读 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">持续写 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">峰值写 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.burstWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 IOPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 IOPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}

function GPFSECEResult({ data }: { data: GPFSECEPlanResult }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">GPFS ECE 规划方案</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">服务器台数</dt>
              <dd>{data.serverCount} 台</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">纠删码方案</dt>
              <dd>{data.ecScheme}（容忍 {data.tolerance} 节点离线）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">磁盘配置</dt>
              <dd>{data.ssdConfig}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">容量</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">可用容量</dt>
              <dd className="text-xl font-bold text-blue-600">{data.formatted.capacity}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">裸容量</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
          </dl>
        </div>
        <div className="md:col-span-2">
          <h3 className="font-semibold text-gray-700 mb-2">性能（800Gb RoCE）</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">读 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 IOPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 IOPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
