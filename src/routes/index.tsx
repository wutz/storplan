import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'

export const Route = createFileRoute('/')({ component: StorplanApp })

function StorplanApp() {
  const [storage, setStorage] = useState('xeos')
  const [capacity, setCapacity] = useState('')
  const [downloadBW, setDownloadBW] = useState('')
  const [uploadBW, setUploadBW] = useState('')
  const [result, setResult] = useState<XEOSPlanResult | null>(null)
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setResult(null)

    try {
      if (storage !== 'xeos') {
        setError(`存储方案 "${storage}" 暂未支持`)
        return
      }

      const plan = planXEOS({
        capacity,
        uploadBandwidth: uploadBW || undefined,
        downloadBandwidth: downloadBW || undefined,
      })

      setResult(plan)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

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
                onChange={(e) => setStorage(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="xeos">XSKY XEOS（对象存储）</option>
                <option value="gpfs-ece" disabled>GPFS ECE（开发中）</option>
                <option value="vastdata" disabled>Vastdata（开发中）</option>
                <option value="weka" disabled>Weka（开发中）</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">容量需求</label>
              <input
                type="text"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="例如: 500TiB, 2PB"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">下载带宽（可选）</label>
              <input
                type="text"
                value={downloadBW}
                onChange={(e) => setDownloadBW(e.target.value)}
                placeholder="例如: 20Gbps"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">上传带宽（可选）</label>
              <input
                type="text"
                value={uploadBW}
                onChange={(e) => setUploadBW(e.target.value)}
                placeholder="例如: 10Gbps"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
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

        {result && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">XSKY XEOS 规划方案</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">配置</h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">服务器台数</dt>
                    <dd>{result.serverCount} 台</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">纠删码方案</dt>
                    <dd>{result.ecScheme}（容忍 {result.tolerance} 节点离线）</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">磁盘配置</dt>
                    <dd>每台 32 × {result.diskSize}TB HDD</dd>
                  </div>
                </dl>
              </div>
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">可用容量</h3>
                <p className="text-2xl font-bold text-blue-600">
                  {result.formatted.capacity}
                </p>
              </div>
              <div className="md:col-span-2">
                <h3 className="font-semibold text-gray-700 mb-2">性能</h3>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">上传带宽</dt>
                    <dd className="font-medium">{result.formatted.uploadBandwidth}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">下载带宽</dt>
                    <dd className="font-medium">{result.formatted.downloadBandwidth}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">上传 OPS</dt>
                    <dd className="font-medium">{result.formatted.uploadOps}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">下载 OPS</dt>
                    <dd className="font-medium">{result.formatted.downloadOps}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
