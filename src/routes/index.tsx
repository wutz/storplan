import { useState } from 'react'
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
  const [downloadBWUnit, setDownloadBWUnit] = useState('Gbps')
  const [uploadBWValue, setUploadBWValue] = useState('')
  const [uploadBWUnit, setUploadBWUnit] = useState('Gbps')
  const [result, setResult] = useState<PlanResult | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setResult(null)

    try {
      const capacity = capacityValue ? `${capacityValue}${capacityUnit}` : ''

      if (storage === 'xeos') {
        const uploadBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const downloadBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const plan = planXEOS({
          capacity,
          uploadBandwidth: uploadBW || undefined,
          downloadBandwidth: downloadBW || undefined,
        })
        setResult({ type: 'xeos', data: plan })
      } else if (storage === 'vastdata') {
        const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const plan = planVastData({
          capacity,
          readBandwidth: readBW || undefined,
          writeBandwidth: writeBW || undefined,
        })
        setResult({ type: 'vastdata', data: plan })
      } else if (storage === 'gpfs-ece') {
        const readBW = downloadBWValue ? `${downloadBWValue}${downloadBWUnit}` : ''
        const writeBW = uploadBWValue ? `${uploadBWValue}${uploadBWUnit}` : ''
        const plan = planGPFSECE({
          capacity,
          readBandwidth: readBW || undefined,
          writeBandwidth: writeBW || undefined,
        })
        setResult({ type: 'gpfs-ece', data: plan })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const bwLabels = storage === 'xeos'
    ? { read: '下载带宽（可选）', write: '上传带宽（可选）' }
    : { read: '读带宽（可选）', write: '写带宽（可选）' }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Storplan</h1>
        <p className="text-gray-600 mb-8">存储容量和性能规划工具</p>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">容量需求</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={capacityValue}
                  onChange={(e) => setCapacityValue(e.target.value)}
                  placeholder="500"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  required
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
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                </select>
              </div>
            </div>
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700"
          >
            开始规划
          </button>
        </form>

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
              <dt className="text-gray-500">上传带宽</dt>
              <dd className="font-medium">{data.formatted.uploadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">下载带宽</dt>
              <dd className="font-medium">{data.formatted.downloadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">上传 OPS</dt>
              <dd className="font-medium">{data.formatted.uploadOps}</dd>
            </div>
            <div>
              <dt className="text-gray-500">下载 OPS</dt>
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
              <dt className="text-gray-500">读带宽</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">持续写带宽</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">峰值写带宽</dt>
              <dd className="font-medium">{data.formatted.burstWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 IOPS</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 IOPS</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
        <div className="md:col-span-2 bg-gray-50 rounded p-3 text-xs text-gray-500">
          支持协议：NFS v3/v4、SMB、S3、iSCSI、NVMe-oF（统一存储池）
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
              <dt className="text-gray-500">读带宽</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写带宽</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 IOPS</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 IOPS</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  )
}
