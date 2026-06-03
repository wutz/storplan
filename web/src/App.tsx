import { useState } from 'react'

interface PlanResult {
  solution: string
  serverCount: number
  capacity: { usableCapacity: number; unit: string }
  performance: {
    readBandwidth: number
    writeBandwidth: number
    readIOPS: number
    writeIOPS: number
    bandwidthUnit: string
  }
  configuration: Record<string, string>
}

function App() {
  const [storage, setStorage] = useState('xeos')
  const [capacity, setCapacity] = useState('')
  const [readBW, setReadBW] = useState('')
  const [writeBW, setWriteBW] = useState('')
  const [result, setResult] = useState<PlanResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)

    try {
      const body: Record<string, unknown> = { storage, capacity }
      if (readBW || writeBW) {
        body.performance = {
          readBandwidth: readBW || undefined,
          writeBandwidth: writeBW || undefined,
        }
      }

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Planning failed')
      } else {
        setResult(data)
      }
    } catch (err) {
      setError('Failed to connect to server')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Storplan</h1>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">读带宽（可选）</label>
              <input
                type="text"
                value={readBW}
                onChange={(e) => setReadBW(e.target.value)}
                placeholder="例如: 20Gbps"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">写带宽（可选）</label>
              <input
                type="text"
                value={writeBW}
                onChange={(e) => setWriteBW(e.target.value)}
                placeholder="例如: 10Gbps"
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '规划中...' : '开始规划'}
          </button>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {result && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">{result.solution} 规划方案</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">配置</h3>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">服务器台数</dt>
                    <dd>{result.serverCount} 台</dd>
                  </div>
                  {Object.entries(result.configuration).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <dt className="text-gray-500">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="font-semibold text-gray-700 mb-2">容量</h3>
                <p className="text-2xl font-bold text-blue-600">
                  {result.capacity.usableCapacity.toFixed(2)} {result.capacity.unit}
                </p>
              </div>
              <div className="md:col-span-2">
                <h3 className="font-semibold text-gray-700 mb-2">性能</h3>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-gray-500">上传带宽 (4MiB)</dt>
                    <dd className="font-medium">{result.performance.writeBandwidth.toFixed(2)} {result.performance.bandwidthUnit}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">下载带宽 (4MiB)</dt>
                    <dd className="font-medium">{result.performance.readBandwidth.toFixed(2)} {result.performance.bandwidthUnit}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">上传 OPS (4KiB)</dt>
                    <dd className="font-medium">{result.performance.writeIOPS.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">下载 OPS (4KiB)</dt>
                    <dd className="font-medium">{result.performance.readIOPS.toLocaleString()}</dd>
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

export default App
