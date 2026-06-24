import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS, buildXEOSResult, buildUltraLargeFromServers, getAllowedEcSchemes, calculatePoolConfig as xeosPoolConfig, CONSTANTS as XEOS_CONSTANTS, EC_SCHEMES as XEOS_EC_SCHEMES, calculateCapacityTiB as xeosCapacity, calculateCacheConfig as xeosCacheConfig } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData, buildVastDataResult, CONSTANTS as VAST_CONSTANTS, calculateCapacityTiB as vastCapacity } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE, buildGPFSECEResult, getECScheme as getGpfsEcScheme, getGPFSTolerance, getAllowedECSchemes, CONSTANTS as GPFS_CONSTANTS, EC_SCHEMES as GPFS_EC_SCHEMES, calculateCapacityTiB as gpfsCapacity } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'
import { formatBandwidth, formatCapacity } from '#/lib/utils'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResults = {
  xeos?: XEOSPlanResult
  vastdata?: VastDataPlanResult
  'gpfs-ece'?: GPFSECEPlanResult
}

// 每个存储产品的官网主题色（Tailwind 静态类名，避免运行时拼接导致 JIT 漏扫）
// VastData → 品牌紫 / GPFS·Scale（IBM）→ IBM 蓝 / XSKY → 天空青
type Theme = {
  label: string
  accentText: string
  accentBgSoft: string
  accentBorder: string
  chip: string
  bigValue: string
  selectedCard: string
  dot: string
  accentBar: string
}

const THEME: Record<string, Theme> = {
  vastdata: {
    // VastData 官网品牌色：亮青 #23D1FE 配深藏蓝文字 #0D1021
    label: 'VastData（统一存储）',
    accentText: 'text-[#0D1021]',
    accentBgSoft: 'bg-[#23D1FE]/10',
    accentBorder: 'border-[#23D1FE]',
    chip: 'bg-[#23D1FE]/20 text-[#0D1021]',
    bigValue: 'text-[#0D1021]',
    selectedCard: 'border-[#23D1FE] bg-[#23D1FE] ring-1 ring-[#23D1FE]',
    dot: 'bg-[#0D1021]',
    accentBar: 'bg-[#23D1FE]',
  },
  'gpfs-ece': {
    label: 'GPFS/Scale（文件系统）',
    accentText: 'text-blue-600',
    accentBgSoft: 'bg-blue-50',
    accentBorder: 'border-blue-200',
    chip: 'bg-blue-100 text-blue-700',
    bigValue: 'text-blue-600',
    selectedCard: 'border-blue-500 bg-blue-50 ring-1 ring-blue-500',
    dot: 'bg-blue-500',
    accentBar: 'bg-blue-500',
  },
  xeos: {
    // XSKY 官网品牌色：紫 #704BFF
    label: 'XSKY XEOS（对象存储）',
    accentText: 'text-[#704BFF]',
    accentBgSoft: 'bg-[#704BFF]/10',
    accentBorder: 'border-[#704BFF]',
    chip: 'bg-[#704BFF]/15 text-[#704BFF]',
    bigValue: 'text-[#704BFF]',
    selectedCard: 'border-[#704BFF] bg-[#704BFF]/10 ring-1 ring-[#704BFF]',
    dot: 'bg-[#704BFF]',
    accentBar: 'bg-[#704BFF]',
  },
}

const STORAGE_ORDER = ['vastdata', 'gpfs-ece', 'xeos'] as const

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
  const [selectedStorages, setSelectedStorages] = useState<Set<string>>(new Set())
  const [capacityValue, setCapacityValue] = useState('1024')
  const [capacityUnit, setCapacityUnit] = useState('TiB')
  const [downloadBWValue, setDownloadBWValue] = useState('')
  const [bwUnit, setBwUnit] = useState('GB/s')
  const [uploadBWValue, setUploadBWValue] = useState('')
  const [results, setResults] = useState<PlanResults>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [manualConfig, setManualConfig] = useState<{
    xeos?: { serverCount: number; disksPerServer: number; diskSize: number; ecEfficiency: number; cacheCount: number; cacheSizePerDisk: number };
    vastdata?: { eboxCount: number; diskSize: number };
    'gpfs-ece'?: { serverCount: number; ssdSize: number; ecEfficiency: number; ssdCount: number };
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
            if (mc.serverCount * mc.disksPerServer > XEOS_CONSTANTS.MAX_TOTAL_DISKS) {
              // 手动服务器台数 × 每台 HDD 超过 2000 -> 超大规模两级架构（含一级元数据集群）
              newResults.xeos = buildUltraLargeFromServers(mc.serverCount, mc.disksPerServer, mc.diskSize, mc.cacheCount, mc.cacheSizePerDisk, isBinary, bandwidthUnitType)
            } else {
              const allowedSchemes = getAllowedEcSchemes(mc.serverCount)
              const ec = allowedSchemes.find((s: any) => s.efficiency === mc.ecEfficiency) || allowedSchemes[0]
              const result = buildXEOSResult(mc.serverCount, mc.disksPerServer, mc.diskSize, ec.scheme, ec.efficiency, ec.tolerance, isBinary, bandwidthUnitType)
              // 应用手动缓存配置
              result.cacheConfig = { count: mc.cacheCount, sizePerDisk: mc.cacheSizePerDisk, totalSize: mc.cacheCount * mc.cacheSizePerDisk }
              newResults.xeos = result
            }
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
            newResults['gpfs-ece'] = buildGPFSECEResult(mc.serverCount, mc.ssdSize, ec.scheme, ec.efficiency, getGPFSTolerance(mc.serverCount, ec.scheme), isBinary, bandwidthUnitType, mc.ssdCount)
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
      newSet.delete(storage)
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
    const { diskSize, disksPerServer } = results.xeos
    const allowedSchemes = getAllowedEcSchemes(newCount)
    const ec = allowedSchemes[0]
    const newCapacityTiB = xeosCapacity(newCount, disksPerServer, diskSize, ec.efficiency)
    // 调整服务器台数时也自动调整索引缓存盘
    const cache = xeosCacheConfig(disksPerServer, diskSize)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount: newCount, disksPerServer, diskSize, ecEfficiency: ec.efficiency, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosDiskChange = (newDiskSize: number) => {
    if (!results.xeos) return
    const { serverCount, disksPerServer } = results.xeos
    const allowedSchemes = getAllowedEcSchemes(serverCount)
    const ec = allowedSchemes[0]
    const newCapacityTiB = xeosCapacity(serverCount, disksPerServer, newDiskSize, ec.efficiency)
    // 选择数据盘容量时自动调整索引缓存盘
    const cache = xeosCacheConfig(disksPerServer, newDiskSize)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, disksPerServer, diskSize: newDiskSize, ecEfficiency: ec.efficiency, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosDisksPerServerChange = (newDisksPerServer: number) => {
    if (!results.xeos) return
    const { serverCount, diskSize } = results.xeos
    const allowedSchemes = getAllowedEcSchemes(serverCount)
    const ec = allowedSchemes[0]
    const newCapacityTiB = xeosCapacity(serverCount, newDisksPerServer, diskSize, ec.efficiency)
    // 选择每台 HDD 数量时自动调整索引缓存盘
    const cache = xeosCacheConfig(newDisksPerServer, diskSize)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, disksPerServer: newDisksPerServer, diskSize, ecEfficiency: ec.efficiency, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosEcChange = (ecEfficiency: number) => {
    if (!results.xeos) return
    const { serverCount, diskSize, disksPerServer, cacheConfig } = results.xeos
    const newCapacityTiB = xeosCapacity(serverCount, disksPerServer, diskSize, ecEfficiency)
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, disksPerServer, diskSize, ecEfficiency, cacheCount: cacheConfig.count, cacheSizePerDisk: cacheConfig.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleXeosCacheCountChange = (newCount: number) => {
    if (!results.xeos) return
    const { serverCount, diskSize, disksPerServer, cacheConfig } = results.xeos
    const requiredCacheTB = (disksPerServer * diskSize) / XEOS_CONSTANTS.CACHE_RATIO
    const totalCacheSize = newCount * cacheConfig.sizePerDisk

    // 缓存总容量不能小于需求
    if (totalCacheSize < requiredCacheTB) return

    const allowedSchemes = getAllowedEcSchemes(serverCount)
    const ec = allowedSchemes[0]
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, disksPerServer, diskSize, ecEfficiency: ec.efficiency, cacheCount: newCount, cacheSizePerDisk: cacheConfig.sizePerDisk } }))
  }

  const handleXeosCacheSizeChange = (newSize: number) => {
    if (!results.xeos) return
    const { serverCount, diskSize, disksPerServer, cacheConfig } = results.xeos
    const requiredCacheTB = (disksPerServer * diskSize) / XEOS_CONSTANTS.CACHE_RATIO
    const totalCacheSize = cacheConfig.count * newSize

    // 缓存总容量不能小于需求
    if (totalCacheSize < requiredCacheTB) return

    const allowedSchemes = getAllowedEcSchemes(serverCount)
    const ec = allowedSchemes[0]
    setManualConfig(prev => ({ ...prev, xeos: { serverCount, disksPerServer, diskSize, ecEfficiency: ec.efficiency, cacheCount: cacheConfig.count, cacheSizePerDisk: newSize } }))
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
    if (!results['gpfs-ece'] || newCount < 3 || newCount > GPFS_CONSTANTS.MAX_SERVERS) return
    const { ssdSize, ssdCount } = results['gpfs-ece']
    const ec = getGpfsEcScheme(newCount)
    const newCapacityTiB = gpfsCapacity(newCount, ssdSize, ec.efficiency, ssdCount)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount: newCount, ssdSize, ecEfficiency: ec.efficiency, ssdCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsDiskChange = (newSsdSize: number) => {
    if (!results['gpfs-ece']) return
    const { serverCount, ssdCount } = results['gpfs-ece']
    const ec = getGpfsEcScheme(serverCount)
    const newCapacityTiB = gpfsCapacity(serverCount, newSsdSize, ec.efficiency, ssdCount)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount, ssdSize: newSsdSize, ecEfficiency: ec.efficiency, ssdCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsEcChange = (ecEfficiency: number) => {
    if (!results['gpfs-ece']) return
    const { serverCount, ssdSize, ssdCount } = results['gpfs-ece']
    const newCapacityTiB = gpfsCapacity(serverCount, ssdSize, ecEfficiency, ssdCount)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount, ssdSize, ecEfficiency, ssdCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleGpfsSsdCountChange = (newSsdCount: number) => {
    if (!results['gpfs-ece']) return
    const { serverCount, ssdSize } = results['gpfs-ece']
    const ec = getGpfsEcScheme(serverCount)
    const newCapacityTiB = gpfsCapacity(serverCount, ssdSize, ec.efficiency, newSsdCount)
    setManualConfig(prev => ({ ...prev, 'gpfs-ece': { serverCount, ssdSize, ecEfficiency: ec.efficiency, ssdCount: newSsdCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const hasSelection = selectedStorages.size > 0
  const selectClass = "border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition"
  const inputClass = "flex-1 border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-400 transition"

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Storplan</h1>
          <p className="text-gray-500 mt-1">存储容量和性能规划工具</p>
        </header>

        <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6 mb-8">
          <label className="block text-sm font-medium text-gray-700 mb-3">存储方案</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {STORAGE_ORDER.map((key) => {
              const t = THEME[key]
              const active = selectedStorages.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleStorage(key)}
                  className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left transition ${active ? t.selectedCard : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${active ? t.dot : 'bg-gray-300'}`} />
                  <span className={`text-sm font-medium ${active ? t.accentText : 'text-gray-600'}`}>{t.label}</span>
                </button>
              )
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">容量</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={capacityValue}
                  onChange={(e) => { setCapacityValue(e.target.value); setManualConfig({}) }}
                  placeholder="500"
                  className={inputClass}
                  min="0"
                  step="0.1"
                />
                <select
                  value={capacityUnit}
                  onChange={(e) => { setCapacityUnit(e.target.value); setManualConfig({}) }}
                  className={selectClass}
                >
                  <option value="TiB">TiB</option>
                  <option value="PiB">PiB</option>
                  <option value="TB">TB</option>
                  <option value="PB">PB</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{bwLabels.read}</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={downloadBWValue}
                  onChange={(e) => { setDownloadBWValue(e.target.value); setManualConfig({}) }}
                  placeholder="20"
                  className={inputClass}
                  min="0"
                  step="0.1"
                />
                <select
                  value={bwUnit}
                  onChange={(e) => { setBwUnit(e.target.value); setManualConfig({}) }}
                  className={selectClass}
                >
                  <option value="MB/s">MB/s</option>
                  <option value="GB/s">GB/s</option>
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{bwLabels.write}</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={uploadBWValue}
                  onChange={(e) => { setUploadBWValue(e.target.value); setManualConfig({}) }}
                  placeholder="10"
                  className={inputClass}
                  min="0"
                  step="0.1"
                />
                <select
                  value={bwUnit}
                  onChange={(e) => { setBwUnit(e.target.value); setManualConfig({}) }}
                  className={selectClass}
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

        {!hasSelection && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-12 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900">请选择存储方案</h3>
            <p className="mt-1 text-sm text-gray-500">在上方勾选一个或多个存储产品，开始容量与性能规划。</p>
          </div>
        )}

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
                <GPFSECEResult data={results['gpfs-ece']} onServerCountChange={handleGpfsServerCountChange} onDiskChange={handleGpfsDiskChange} onEcChange={handleGpfsEcChange} onSsdCountChange={handleGpfsSsdCountChange} />
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
                <XEOSResult data={results.xeos} onServerCountChange={handleXeosServerCountChange} onDiskChange={handleXeosDiskChange} onDisksPerServerChange={handleXeosDisksPerServerChange} onEcChange={handleXeosEcChange} onCacheCountChange={handleXeosCacheCountChange} onCacheSizeChange={handleXeosCacheSizeChange} />
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
  const t = THEME[storage]

  return (
    <div className={`relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6 mb-4`}>
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
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

function XEOSResult({ data, onServerCountChange, onDiskChange, onDisksPerServerChange, onEcChange, onCacheCountChange, onCacheSizeChange }: {
  data: XEOSPlanResult;
  onServerCountChange: (n: number) => void;
  onDiskChange: (n: number) => void;
  onDisksPerServerChange: (n: number) => void;
  onEcChange: (n: number) => void;
  onCacheCountChange: (n: number) => void;
  onCacheSizeChange: (n: number) => void;
}) {
  const ul = data.ultraLarge
  const mc = ul?.metadataCluster
  // 末簇容忍离线节点数：末簇可能少于/多于 40 台，池数与满簇不同（<20 台 → 1 池容忍 2，20+ 台 → 2 池容忍 4）
  const lastClusterTolerance = ul ? (xeosPoolConfig(ul.lastClusterNodes, 'EC8+2')?.totalTolerance ?? 2) : 0
  const lastClusterIsFull = ul ? ul.lastClusterNodes === ul.nodesPerCluster : true
  const perTiBReadBW = data.performance.downloadBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * 1.024).toFixed(2) + ' MB/s'
  const totalDisks = data.serverCount * data.disksPerServer
  const hddLimit = ul ? XEOS_CONSTANTS.MAX_TOTAL_DISKS_ULTRA : XEOS_CONSTANTS.MAX_TOTAL_DISKS
  const requiredCacheTB = (data.disksPerServer * data.diskSize) / XEOS_CONSTANTS.CACHE_RATIO
  const isCacheSufficient = data.cacheConfig.totalSize >= requiredCacheTB
  const t = THEME.xeos

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-xl font-bold text-gray-900">XSKY XEOS 规划方案</h2>
        {ul && <span className={`text-xs ${t.chip} px-2 py-0.5 rounded-full`}>超大规模架构（两级）</span>}
      </div>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">{ul ? '二级总服务器台数' : '服务器台数'}</dt>
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
            <div className="flex justify-between">
              <dt className="text-gray-500">{ul ? '二级集群 HDD 总数' : '集群 HDD 总数'}</dt>
              <dd className={totalDisks > hddLimit ? 'text-red-600 font-semibold' : ''}>{totalDisks.toLocaleString()} / {hddLimit.toLocaleString()} 块 {totalDisks > hddLimit && '⚠️ 超出上限'}</dd>
            </div>
            {ul && (
              <div className="flex justify-between">
                <dt className="text-gray-500">二级数据集群</dt>
                <dd>{ul.lastClusterNodes === ul.nodesPerCluster
                  ? `${ul.tier2ClusterCount} 个 × ${ul.nodesPerCluster} 节点`
                  : `${ul.tier2ClusterCount} 个（前 ${ul.tier2ClusterCount - 1} 个 × ${ul.nodesPerCluster} + 末簇 ${ul.lastClusterNodes} 节点）`}</dd>
              </div>
            )}
            {ul ? (
              <div className="flex justify-between">
                <dt className="text-gray-500">纠删码方案</dt>
                <dd>EC8+2（每集群 2 池）</dd>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">纠删码方案</dt>
                <dd>
                  <select value={data.ecScheme} onChange={(e) => { const s = XEOS_EC_SCHEMES.find(s => s.scheme === e.target.value); if (s) onEcChange(s.efficiency) }} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                    {getAllowedEcSchemes(data.serverCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                  </select>
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">容错能力</dt>
              <dd>{ul
                ? (lastClusterIsFull
                    ? `每集群容忍 ${ul.tier2PerClusterTolerance} 台节点离线`
                    : `满簇容忍 ${ul.tier2PerClusterTolerance} 台（末簇 ${ul.lastClusterNodes} 节点容忍 ${lastClusterTolerance} 台）`)
                : `容忍 ${data.tolerance} 台节点离线`}</dd>
            </div>
            {data.poolConfig && (
              <div className="flex justify-between">
                <dt className="text-gray-500">池数</dt>
                <dd>{data.poolConfig.poolCount} 个池</dd>
              </div>
            )}
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">容量</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">可用容量</dt>
              <dd className={`text-xl font-bold ${t.bigValue}`}>{data.formatted.capacity}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">裸容量</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
            {ul && (
              <>
                <div className="flex justify-between">
                  <dt className="text-gray-500">单集群可用容量</dt>
                  <dd>{formatCapacity(ul.tier2PerClusterCapacity, data.capacityUnitPreference)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">二级 SSD 总容量</dt>
                  <dd>{ul.tier2CacheSSDTotal.toLocaleString()} TB</dd>
                </div>
              </>
            )}
          </dl>
        </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">{ul ? '每台二级数据节点配置（混闪）' : '每台服务器配置'}</h3>
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
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd className="flex items-center gap-1">
                <select value={data.disksPerServer} onChange={(e) => onDisksPerServerChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {XEOS_CONSTANTS.DISKS_PER_SERVER_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {XEOS_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>HDD</span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">索引缓存盘</dt>
              <dd className="flex items-center gap-1">
                <select value={data.cacheConfig.count} onChange={(e) => onCacheCountChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {[1, 2, 3, 4].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.cacheConfig.sizePerDisk} onChange={(e) => onCacheSizeChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {XEOS_CONSTANTS.CACHE_DISK_SIZES.map(s => <option key={s} value={s}>{s}TB</option>)}
                </select>
                <span className="text-xs">NVMe SSD（DWPD ≥ 3）</span>
                {!isCacheSufficient && <span className="text-red-600 text-xs">⚠️ 不足</span>}
              </dd>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <dt>缓存容量要求</dt>
              <dd>≥ {requiredCacheTB.toFixed(2)}TB（实际 {data.cacheConfig.totalSize.toFixed(2)}TB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">网卡</dt>
              <dd>2 × 双口 25Gb ETH NIC</dd>
            </div>
          </dl>
        </div>
        {ul && mc && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="font-semibold text-gray-700 mb-2">一级元数据集群（全闪 NVMe）</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">节点数</dt><dd>{mc.nodeCount} 台（{mc.ecScheme}，范围 6–20）</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">处理器</dt><dd>2 × Intel 6330</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">内存</dt><dd>256GB</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">系统盘</dt><dd>2 × 960GB SATA SSD（RAID1）</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">数据盘</dt><dd>{mc.disksPerNode} × {mc.diskSize}TB NVMe SSD（DWPD ≥ 3）</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">NVMe 总容量</dt><dd>{mc.totalSize.toLocaleString()} TB</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">网卡</dt><dd>2 × 双口 25Gb ETH NIC</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">容错能力</dt><dd>容忍 {mc.tolerance} 台节点离线</dd></div>
              <div className="flex justify-between text-xs text-gray-400"><dt>容量配比</dt><dd>二级SSD总 / 一级NVMe总 = {ul.ratio.toFixed(2)}（目标 5）</dd></div>
            </dl>
          </div>
        )}
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">{ul ? '性能（厂商数据，基于二级 HDD）' : '性能（厂商数据）'}</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">下载 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.downloadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">上传 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.uploadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">每 TiB 下载 BW (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-gray-500">下载 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.downloadOps}</dd>
            </div>
            <div>
              <dt className="text-gray-500">上传 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.uploadOps}</dd>
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
  const t = THEME.vastdata

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <h2 className="text-xl font-bold text-gray-900 mb-4">VastData 统一存储规划方案</h2>
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
              <dd className={`text-xl font-bold ${t.bigValue}`}>{data.formatted.capacity}</dd>
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

function GPFSECEResult({ data, onServerCountChange, onDiskChange, onEcChange, onSsdCountChange }: { data: GPFSECEPlanResult; onServerCountChange: (n: number) => void; onDiskChange: (n: number) => void; onEcChange: (n: number) => void; onSsdCountChange: (n: number) => void }) {
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * 1.024).toFixed(2) + ' MB/s'
  const t = THEME['gpfs-ece']

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <h2 className="text-xl font-bold text-gray-900 mb-4">GPFS/Scale 规划方案</h2>
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
                  max={GPFS_CONSTANTS.MAX_SERVERS}
                  className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                />
                <button onClick={() => onServerCountChange(data.serverCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.serverCount >= GPFS_CONSTANTS.MAX_SERVERS}>+</button>
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
              <dd className={`text-xl font-bold ${t.bigValue}`}>{data.formatted.capacity}</dd>
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
                <select value={data.ssdCount} onChange={(e) => onSsdCountChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {GPFS_CONSTANTS.SSD_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select> × <select value={data.ssdSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
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
