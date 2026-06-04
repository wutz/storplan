import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResults = {
  xeos?: XEOSPlanResult
  vastdata?: VastDataPlanResult
  'gpfs-ece'?: GPFSECEPlanResult
}

function StorplanApp() {
  const [selectedStorages, setSelectedStorages] = useState<Set<string>>(new Set(['xeos']))
  const [capacityValue, setCapacityValue] = useState('')
  const [capacityUnit, setCapacityUnit] = useState('TiB')
  const [downloadBWValue, setDownloadBWValue] = useState('')
  const [downloadBWUnit, setDownloadBWUnit] = useState('GB/s')
  const [uploadBWValue, setUploadBWValue] = useState('')
  const [uploadBWUnit, setUploadBWUnit] = useState('GB/s')
  const [results, setResults] = useState<PlanResults>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!capacityValue && !downloadBWValue && !uploadBWValue) {
      setResults({})
      setErrors({})
      return
    }

    const newResults: PlanResults = {}
    const newErrors: Record<string, string> = {}

    try {
      const capacity = capacityValue ? `${capacityValue}${capacityUnit}` : `0${capacityUnit}`

      if (selectedStorages.has('xeos')) {
        try {
          const uploadBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
          const downloadBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
          const plan = planXEOS({
            capacity,
            uploadBandwidth: uploadBW || undefined,
            downloadBandwidth: downloadBW || undefined,
          })
          newResults.xeos = plan
        } catch (err) {
          newErrors.xeos = err instanceof Error ? err.message : 'Unknown error'
        }
      }

      if (selectedStorages.has('vastdata')) {
        try {
          const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
          const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
          const plan = planVastData({
            capacity,
            readBandwidth: readBW || undefined,
            writeBandwidth: writeBW || undefined,
          })
          newResults.vastdata = plan
        } catch (err) {
          newErrors.vastdata = err instanceof Error ? err.message : 'Unknown error'
        }
      }

      if (selectedStorages.has('gpfs-ece')) {
        try {
          const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
          const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
          const plan = planGPFSECE({
            capacity,
            readBandwidth: readBW || undefined,
            writeBandwidth: writeBW || undefined,
          })
          newResults['gpfs-ece'] = plan
        } catch (err) {
          newErrors['gpfs-ece'] = err instanceof Error ? err.message : 'Unknown error'
        }
      }
    } catch (err) {
      // Global error handling if needed
    }

    setResults(newResults)
    setErrors(newErrors)
  }, [selectedStorages, capacityValue, capacityUnit, downloadBWValue, downloadBWUnit, uploadBWValue, uploadBWUnit])

  const toggleStorage = (storage: string) => {
    const newSet = new Set(selectedStorages)
    if (newSet.has(storage)) {
      if (newSet.size > 1) {
        newSet.delete(storage)
      }
    } else {
      newSet.add(storage)
    }
    setSelectedStorages(newSet)
  }

  const bwLabels = selectedStorages.size === 1 && selectedStorages.has('xeos')
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
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('xeos')} onChange={() => toggleStorage('xeos')} className="rounded" />
                  <span className="text-sm">XSKY XEOS（对象存储）</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('vastdata')} onChange={() => toggleStorage('vastdata')} className="rounded" />
                  <span className="text-sm">VastData（统一存储）</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('gpfs-ece')} onChange={() => toggleStorage('gpfs-ece')} className="rounded" />
                  <span className="text-sm">GPFS/Scale（文件系统）</span>
                </label>
              </div>
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
                  <option value="PiB">PiB</option>
                  <option value="TB">TB</option>
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

        {selectedStorages.has('xeos') && <StorageInfo storage="xeos" />}
        {selectedStorages.has('vastdata') && <StorageInfo storage="vastdata" />}
        {selectedStorages.has('gpfs-ece') && <StorageInfo storage="gpfs-ece" />}

        {errors.xeos && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800"><strong>XEOS:</strong> {errors.xeos}</p>
          </div>
        )}
        {errors.vastdata && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800"><strong>VastData:</strong> {errors.vastdata}</p>
          </div>
        )}
        {errors['gpfs-ece'] && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800"><strong>GPFS/Scale:</strong> {errors['gpfs-ece']}</p>
          </div>
        )}

        {results.xeos && (
          <div className="mb-8">
            <XEOSResult data={results.xeos} />
          </div>
        )}
        {results.vastdata && (
          <div className="mb-8">
            <VastDataResult data={results.vastdata} />
          </div>
        )}
        {results['gpfs-ece'] && (
          <div className="mb-8">
            <GPFSECEResult data={results['gpfs-ece']} />
          </div>
        )}
      </div>
    </div>
  )
}

const STORAGE_INFO: Record<string, { description: string; pros: string[]; cons: string[] }> = {
  xeos: {
    description: 'XSKY XEOS 是分布式对象存储系统，基于 HDD 构建大容量存储池，适合海量非结构化数据存储。',
    pros: ['支持超大规模集群', '支持 QoS', '稳定可靠', '支持 CRC64 校验', '原厂技术支持'],
    cons: ['软件授权较贵', '得盘率稍低提升成本'],
  },
  vastdata: {
    description: 'VastData 是全闪统一存储平台，单一系统同时提供文件、对象和块存储服务，基于 NVMe SSD 和 SCM 构建。',
    pros: ['支持多存储协议可以平替 Ceph', '支持多租户', '去重与压缩提升集群可用容量', '支持 QoS 以及元数据 QoS', '原厂技术支持'],
    cons: ['采购费用高于 GPFS', '采用 QLC 大盘性能低于 GPFS 等采用 TLC 小盘的存储系统', '采购周期较长'],
  },
  'gpfs-ece': {
    description: 'IBM GPFS/Scale ECE（Erasure Coding Edition）是高性能并行文件系统，基于 NVMe SSD 和 RDMA 网络构建。',
    pros: ['性能高', '采购成本低'],
    cons: ['多租户支持弱', '运维成本高', '原厂支持弱'],
  },
}

function StorageInfo({ storage }: { storage: string }) {
  const info = STORAGE_INFO[storage]
  if (!info) return null

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-8">
      <p className="text-gray-600 mb-4">{info.description}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="font-semibold text-green-700 mb-2">优势</h3>
          <ul className="space-y-1 text-gray-600">
            {info.pros.map((p, i) => <li key={i}>• {p}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold text-orange-700 mb-2">劣势</h3>
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
            <div className="flex justify-between">
              <dt className="text-gray-500">网络配置</dt>
              <dd>2 × 双口 25Gb ETH NIC</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">可用容量</h3>
          <p className="text-2xl font-bold text-blue-600">{data.formatted.capacity}</p>
        </div>
        <div className="md:col-span-2">
          <h3 className="font-semibold text-gray-700 mb-2">性能（预测数据）</h3>
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
            <div className="flex justify-between">
              <dt className="text-gray-500">网络配置</dt>
              <dd>2 × 双口 200Gb RoCE/IB/ETH NIC</dd>
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
          <h3 className="font-semibold text-gray-700 mb-2">性能（厂商数据）</h3>
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
      <h2 className="text-xl font-bold mb-4">GPFS/Scale 规划方案</h2>
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
            <div className="flex justify-between">
              <dt className="text-gray-500">网络配置</dt>
              <dd>2 × 双口 200Gb RoCE/IB NIC</dd>
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
          <h3 className="font-semibold text-gray-700 mb-2">性能（预测数据）</h3>
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
