import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS, buildXEOSResult, getAllowedEcSchemes, CONSTANTS as XEOS_CONSTANTS, EC_SCHEMES as XEOS_EC_SCHEMES, calculateCapacityTiB as xeosCapacity } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData, buildVastDataResult, CONSTANTS as VAST_CONSTANTS, calculateCapacityTiB as vastCapacity } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE, buildGPFSECEResult, getECScheme as getGpfsEcScheme, getGPFSTolerance, getAllowedECSchemes, CONSTANTS as GPFS_CONSTANTS, EC_SCHEMES as GPFS_EC_SCHEMES, calculateCapacityTiB as gpfsCapacity } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'
import { formatBandwidth } from '#/lib/utils'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResults = {
  xeos?: XEOSPlanResult
  vastdata?: VastDataPlanResult
  'gpfs-ece'?: GPFSECEPlanResult
}

function convertTibToUnit(tib: number, unit: string): string {
  switch (unit) {
    case 'TiB': return tib.toFixed(2)
    case 'PiB': return (tib / 1024).toFixed(2)
    case 'TB': return (tib / 0.909).toFixed(2)
    case 'PB': return (tib / 0.909 / 1000).toFixed(2)
    default: return tib.toFixed(2)
  }
}

function NumberInput({ value, onChange, min, max, disabled, className }: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(String(value))

  useEffect(() => {
    setLocalValue(String(value))
  }, [value])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value)
  }

  const handleBlur = () => {
    const n = Number(localValue)
    if (!isNaN(n) && n >= (min ?? 0) && (max === undefined || n <= max)) {
      onChange(n)
    } else {
      setLocalValue(String(value))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleBlur()
    }
  }

  return (
    <input
      type="number"
      value={localValue}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      min={min}
      max={max}
      disabled={disabled}
      className={className}
    />
  )
}

function StorplanApp() {
  const [selectedStorages, setSelectedStorages] = useState<Set<string>>(new Set(['vastdata']))
  const [capacityValue, setCapacityValue] = useState('1024')
  const [capacityUnit, setCapacityUnit] = useState('TiB')
  const [downloadBWValue, setDownloadBWValue] = useState('')
  const [bwUnit, setBwUnit] = useState('GB/s')
  const [uploadBWValue, setUploadBWValue] = useState('')
  const [results, setResults] = useState<PlanResults>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [manualConfig, setManualConfig] = useState<{
    xeos?: { serverCount: number; diskSize: number; ecEfficiency: number };
    vastdata?: { eboxCount: number; diskSize: number };
    'gpfs-ece'?: { serverCount: number; ssdSize: number; ecEfficiency: number };
  }>({})

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
      const isBinary = capacityUnit === 'TiB' || capacityUnit === 'PiB'
      const bandwidthUnitType = bwUnit.includes('iB') ? 'binary' : bwUnit.includes('bps') ? 'decimal-bit' : 'decimal-byte'

      if (selectedStorages.has('xeos')) {
        try {
          if (manualConfig.xeos) {
            const mc = manualConfig.xeos
            const allowedSchemes = getAllowedEcSchemes(mc.serverCount)
            const ec = allowedSchemes.find((s: any) => s.efficiency === mc.ecEfficiency) || allowedSchemes[0]
            newResults.xeos = buildXEOSResult(mc.serverCount, mc.diskSize, ec.scheme, ec.efficiency, ec.tolerance, isBinary, bandwidthUnitType)
          } else {
            const uploadBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const downloadBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const result = planXEOS({ capacity, uploadBandwidth: uploadBW || undefined, downloadBandwidth: downloadBW || undefined })
            // Override bandwidth formatting to match input unit
            result.formatted.uploadBandwidth = formatBandwidth(result.performance.uploadBandwidth, bandwidthUnitType)
            result.formatted.downloadBandwidth = formatBandwidth(result.performance.downloadBandwidth, bandwidthUnitType)
            newResults.xeos = result
          }
        } catch (err) {
          newErrors.xeos = err instanceof Error ? err.message : 'Unknown error'
        }
      }

      if (selectedStorages.has('vastdata')) {
        try {
          if (manualConfig.vastdata) {
            const mc = manualConfig.vastdata
            const config = VAST_CONSTANTS.EBOX_CONFIGS.find(c => c.diskSize === mc.diskSize)!
            newResults.vastdata = buildVastDataResult(mc.eboxCount, mc.diskSize, config.label, isBinary, bandwidthUnitType)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planVastData({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            result.formatted.readBandwidth = formatBandwidth(result.performance.readBandwidth, bandwidthUnitType)
            result.formatted.writeBandwidth = formatBandwidth(result.performance.writeBandwidth, bandwidthUnitType)
            result.formatted.burstWriteBandwidth = formatBandwidth(result.performance.burstWriteBandwidth, bandwidthUnitType)
            newResults.vastdata = result
          }
        } catch (err) {
          newErrors.vastdata = err instanceof Error ? err.message : 'Unknown error'
        }
      }

      if (selectedStorages.has('gpfs-ece')) {
        try {
          if (manualConfig['gpfs-ece']) {
            const mc = manualConfig['gpfs-ece']
            const ec = GPFS_EC_SCHEMES.find((s: any) => s.efficiency === mc.ecEfficiency)!
            newResults['gpfs-ece'] = buildGPFSECEResult(mc.serverCount, mc.ssdSize, ec.scheme, ec.efficiency, getGPFSTolerance(mc.serverCount, ec.scheme), isBinary, bandwidthUnitType)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planGPFSECE({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            result.formatted.readBandwidth = formatBandwidth(result.performance.readBandwidth, bandwidthUnitType)
            result.formatted.writeBandwidth = formatBandwidth(result.performance.writeBandwidth, bandwidthUnitType)
            newResults['gpfs-ece'] = result
          }
        } catch (err) {
          newErrors['gpfs-ece'] = err instanceof Error ? err.message : 'Unknown error'
        }
      }
    } catch (err) {
      // Global error handling if needed
    }

    setResults(newResults)
    setErrors(newErrors)
  }, [selectedStorages, capacityValue, capacityUnit, downloadBWValue, bwUnit, uploadBWValue, manualConfig])

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

  const handleXeosServerCountChange = (newCount: number) => {
    if (!results.xeos || newCount < 3) return
    const { diskSize } = results.xeos
    const allowedSchemes = getAllowedEcSchemes(newCount)
    const ec = allowedSchemes[0]
    const newCapacityTiB = xeosCapacity(newCount, diskSize, ec.efficiency)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount: newCount, diskSize, ecEfficiency: ec.efficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosDiskChange = (newDiskSize: number) => {
    if (!results.xeos) return
    const { serverCount } = results.xeos
    const allowedSchemes = getAllowedEcSchemes(serverCount)
    const ec = allowedSchemes[0]
    const newCapacityTiB = xeosCapacity(serverCount, newDiskSize, ec.efficiency)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, diskSize: newDiskSize, ecEfficiency: ec.efficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosEcChange = (ecEfficiency: number) => {
    if (!results.xeos) return
    const { serverCount, diskSize } = results.xeos
    const newCapacityTiB = xeosCapacity(serverCount, diskSize, ecEfficiency)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, diskSize, ecEfficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleVastDataEboxCountChange = (newCount: number) => {
    if (!results.vastdata || newCount < VAST_CONSTANTS.MIN_EBOX || newCount > VAST_CONSTANTS.MAX_EBOX) return
    const { diskSize } = results.vastdata
    const newCapacityTiB = vastCapacity(newCount, diskSize)
    setManualConfig(prev => ({ ...prev, vastdata: { eboxCount: newCount, diskSize } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleVastDataDiskChange = (newDiskSize: number) => {
    if (!results.vastdata) return
    const { eboxCount } = results.vastdata
    const newCapacityTiB = vastCapacity(eboxCount, newDiskSize)
    setManualConfig(prev => ({ ...prev, vastdata: { eboxCount, diskSize: newDiskSize } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsServerCountChange = (newCount: number) => {
    if (!results['gpfs-ece'] || newCount < 3) return
    const { ssdSize } = results['gpfs-ece']
    const ec = getGpfsEcScheme(newCount)
    const newCapacityTiB = gpfsCapacity(newCount, ssdSize, ec.efficiency)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount: newCount, ssdSize, ecEfficiency: ec.efficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsDiskChange = (newSsdSize: number) => {
    if (!results['gpfs-ece']) return
    const { serverCount } = results['gpfs-ece']
    const ec = getGpfsEcScheme(serverCount)
    const newCapacityTiB = gpfsCapacity(serverCount, newSsdSize, ec.efficiency)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount, ssdSize: newSsdSize, ecEfficiency: ec.efficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsEcChange = (ecEfficiency: number) => {
    if (!results['gpfs-ece']) return
    const { serverCount, ssdSize } = results['gpfs-ece']
    const newCapacityTiB = gpfsCapacity(serverCount, ssdSize, ecEfficiency)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount, ssdSize, ecEfficiency } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">Storplan</h1>
        <p className="text-gray-600 mb-8">存储容量和性能规划工具</p>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">存储方案</label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('vastdata')} onChange={() => toggleStorage('vastdata')} className="rounded" />
                  <span className="text-sm">VastData（统一存储）</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('gpfs-ece')} onChange={() => toggleStorage('gpfs-ece')} className="rounded" />
                  <span className="text-sm">GPFS/Scale（文件系统）</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedStorages.has('xeos')} onChange={() => toggleStorage('xeos')} className="rounded" />
                  <span className="text-sm">XSKY XEOS（对象存储）</span>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">容量</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={capacityValue}
                  onChange={(e) => { setCapacityValue(e.target.value); setManualConfig({}) }}
                  placeholder="500"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={capacityUnit}
                  onChange={(e) => { setCapacityUnit(e.target.value); setManualConfig({}) }}
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
                  onChange={(e) => { setDownloadBWValue(e.target.value); setManualConfig({}) }}
                  placeholder="20"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={bwUnit}
                  onChange={(e) => { setBwUnit(e.target.value); setManualConfig({}) }}
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
                  onChange={(e) => { setUploadBWValue(e.target.value); setManualConfig({}) }}
                  placeholder="10"
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                  min="0"
                  step="0.1"
                />
                <select
                  value={bwUnit}
                  onChange={(e) => { setBwUnit(e.target.value); setManualConfig({}) }}
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

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {selectedStorages.has('vastdata') && (
            <div>
              <StorageInfo storage="vastdata" />
              {errors.vastdata && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors.vastdata}</p>
                </div>
              )}
              {results.vastdata && (
                <VastDataResult data={results.vastdata} onEboxCountChange={handleVastDataEboxCountChange} onDiskChange={handleVastDataDiskChange} />
              )}
            </div>
          )}

          {selectedStorages.has('gpfs-ece') && (
            <div>
              <StorageInfo storage="gpfs-ece" />
              {errors['gpfs-ece'] && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors['gpfs-ece']}</p>
                </div>
              )}
              {results['gpfs-ece'] && (
                <GPFSECEResult data={results['gpfs-ece']} onServerCountChange={handleGpfsServerCountChange} onDiskChange={handleGpfsDiskChange} onEcChange={handleGpfsEcChange} />
              )}
            </div>
          )}

          {selectedStorages.has('xeos') && (
            <div>
              <StorageInfo storage="xeos" />
              {errors.xeos && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors.xeos}</p>
                </div>
              )}
              {results.xeos && (
                <XEOSResult data={results.xeos} onServerCountChange={handleXeosServerCountChange} onDiskChange={handleXeosDiskChange} onEcChange={handleXeosEcChange} />
              )}
            </div>
          )}
        </div>

        <footer className="text-center text-sm text-gray-400 mt-12 pb-8">
          <a href="https://github.com/wutz/storplan" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">
            GitHub: wutz/storplan
          </a>
        </footer>
      </div>
    </div>
  )
}

const STORAGE_INFO: Record<string, { description: string; pros: string[]; cons: string[]; limits?: string[] }> = {
  xeos: {
    description: 'XSKY XEOS 是分布式对象存储系统，基于大量 HDD 和少量 NVMe SSD 构建混闪对象存储，适合海量非结构化数据存储。',
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
    limits: ['启用多租户支持时，容量起步和扩容步长均为 50TiB', '启用多租户时，K8s 只能使用 hostPath，不能使用基于 CSI 的 PVC 方式'],
  },
}

function StorageInfo({ storage }: { storage: string }) {
  const info = STORAGE_INFO[storage]
  if (!info) return null

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-4">
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
      {info.limits && (
        <div className="mt-4 text-sm">
          <h3 className="font-semibold text-red-700 mb-2">限制</h3>
          <ul className="space-y-1 text-gray-600">
            {info.limits.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function XEOSResult({ data, onServerCountChange, onDiskChange, onEcChange }: { data: XEOSPlanResult; onServerCountChange: (n: number) => void; onDiskChange: (n: number) => void; onEcChange: (n: number) => void }) {
  const perTiBReadBW = data.performance.downloadBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * 1.024).toFixed(2) + ' MB/s'

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">XSKY XEOS 规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">服务器台数</dt>
              <dd className="flex items-center gap-1">
                <button onClick={() => onServerCountChange(data.serverCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.serverCount <= 3}>−</button>
                <NumberInput
                  value={data.serverCount}
                  onChange={onServerCountChange}
                  min={3}
                  className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                />
                <button onClick={() => onServerCountChange(data.serverCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                <span className="ml-0.5">台</span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">纠删码方案</dt>
              <dd>
                <select value={data.ecScheme} onChange={(e) => { const s = XEOS_EC_SCHEMES.find(s => s.scheme === e.target.value); if (s) onEcChange(s.efficiency) }} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {getAllowedEcSchemes(data.serverCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                </select>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">容错能力</dt>
              <dd>容忍 {data.tolerance} 台节点离线</dd>
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
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台服务器配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>2 × Intel Xeon 4134</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>8 × 32GB DDR4（共 256GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 960GB SATA SSD（RAID1）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">索引缓存盘</dt>
              <dd>4 × 1.6TB NVMe SSD（≥3 DWPD）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">网卡</dt>
              <dd>2 × 双口 25Gb ETH NIC</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd>
                32 × <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {XEOS_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select> HDD
              </dd>
            </div>
          </dl>
        </div>
        <div>
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
              <dt className="text-gray-500">每 TiB 读 BW (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
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

function VastDataResult({ data, onEboxCountChange, onDiskChange }: { data: VastDataPlanResult; onEboxCountChange: (n: number) => void; onDiskChange: (n: number) => void }) {
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * 1.024).toFixed(2) + ' MB/s'

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">VastData 统一存储规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">EBox 数量</dt>
              <dd className="flex items-center gap-1">
                <button onClick={() => onEboxCountChange(data.eboxCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.eboxCount <= 11}>−</button>
                <NumberInput
                  value={data.eboxCount}
                  onChange={onEboxCountChange}
                  min={11}
                  max={250}
                  className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                />
                <button onClick={() => onEboxCountChange(data.eboxCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.eboxCount >= 250}>+</button>
                <span className="ml-0.5">台</span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">容错能力</dt>
              <dd>容忍 2 台节点离线</dd>
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
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台 EBox 配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>AMD 9454P 2.75GHz 290W</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>12 × 32GB DDR5-5600 RDIMM（共 384GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 960GB M.2 SATA SSD</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {VAST_CONSTANTS.EBOX_CONFIGS.map(c => <option key={c.diskSize} value={c.diskSize}>{c.label}</option>)}
                </select>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">网络</dt>
              <dd>2 × 双口 200Gb RoCE/IB/ETH NIC</dd>
            </div>
          </dl>
        </div>
        <div>
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
              <dt className="text-gray-500">每 TiB 读 BW (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
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

function GPFSECEResult({ data, onServerCountChange, onDiskChange, onEcChange }: { data: GPFSECEPlanResult; onServerCountChange: (n: number) => void; onDiskChange: (n: number) => void; onEcChange: (n: number) => void }) {
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * 1.024).toFixed(2) + ' MB/s'

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">GPFS/Scale 规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">服务器台数</dt>
              <dd className="flex items-center gap-1">
                <button onClick={() => onServerCountChange(data.serverCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.serverCount <= 3}>−</button>
                <NumberInput
                  value={data.serverCount}
                  onChange={onServerCountChange}
                  min={3}
                  className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                />
                <button onClick={() => onServerCountChange(data.serverCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                <span className="ml-0.5">台</span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">纠删码方案</dt>
              <dd>
                <select value={data.ecScheme} onChange={(e) => { const s = GPFS_EC_SCHEMES.find(s => s.scheme === e.target.value); if (s) onEcChange(s.efficiency) }} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {getAllowedECSchemes(data.serverCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                </select>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">容错能力</dt>
              <dd>容忍 {data.tolerance} 台节点离线</dd>
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
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台服务器配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>16 × 32GB DDR5 4800（共 512GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 480GB SATA SSD（RAID1）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">存储网络</dt>
              <dd>2 × 双口 200Gb RoCE/IB NIC</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">管理网络</dt>
              <dd>1 × 双口 25Gb 以太网卡</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd>
                24 × <select value={data.ssdSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {GPFS_CONSTANTS.SSD_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select> NVMe SSD
              </dd>
            </div>
          </dl>
        </div>
        <div>
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
              <dt className="text-gray-500">每 TiB 读 BW (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
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
