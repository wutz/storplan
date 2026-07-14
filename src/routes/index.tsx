import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS, buildXEOSResult, buildUltraLargeFromServers, getAllowedEcSchemes, calculatePoolConfig as xeosPoolConfig, CONSTANTS as XEOS_CONSTANTS, EC_SCHEMES as XEOS_EC_SCHEMES, calculateCapacityTiB as xeosCapacity, calculateCacheConfig as xeosCacheConfig } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData, buildVastDataResult, CONSTANTS as VAST_CONSTANTS, calculateCapacityTiB as vastCapacity } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE, buildGPFSECEResult, getECScheme as getGpfsEcScheme, getGPFSTolerance, getAllowedECSchemes, CONSTANTS as GPFS_CONSTANTS, EC_SCHEMES as GPFS_EC_SCHEMES, calculateCapacityTiB as gpfsCapacity } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'
import { planCeph, buildCephResult, getMemoryConfig as getCephMemory, getStorageNetworkConfig as getCephStorageNetwork, getMdsMemoryConfig as getCephMdsMemory, getMdsStorageNetworkConfig as getCephMdsStorageNetwork, getPerDiskPerformance as getCephPerDisk, getAllowedRedundancySchemes as getCephAllowedSchemes, RGW_PER_DISK as CEPH_RGW_PER_DISK, calculateCapacityTiB as cephCapacity, CONSTANTS as CEPH_CONSTANTS } from '#/lib/ceph'
import type { CephPlanResult } from '#/lib/ceph'
import { planCephHybrid, buildCephHybridResult, calculateCacheConfig as cephHybridCacheConfig, calculateCapacityTiB as cephHybridCapacity, getAllowedRedundancySchemes as getCephHybridAllowedSchemes, RGW_HYBRID_PER_DISK, CONSTANTS as CEPH_HYBRID_CONSTANTS } from '#/lib/ceph-hybrid'
import type { CephHybridPlanResult } from '#/lib/ceph-hybrid'
import { planWeka, buildWekaResult, calculateCapacityTiB as wekaCapacity, CONSTANTS as WEKA_CONSTANTS } from '#/lib/weka'
import type { WekaPlanResult } from '#/lib/weka'
import { formatBandwidth, formatCapacity, MIB_TO_MB } from '#/lib/utils'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResults = {
  xeos?: XEOSPlanResult
  vastdata?: VastDataPlanResult
  'gpfs-ece'?: GPFSECEPlanResult
  ceph?: CephPlanResult
  'ceph-hybrid'?: CephHybridPlanResult
  weka?: WekaPlanResult
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
    selectedCard: 'border-[#23D1FE] bg-[#23D1FE]/10 ring-1 ring-[#23D1FE]',
    dot: 'bg-[#23D1FE]',
    accentBar: 'bg-[#23D1FE]',
  },
  'gpfs-ece': {
    // IBM 经典黑色 logo 配色：黑 #111111
    label: 'GPFS/Scale（文件系统）',
    accentText: 'text-[#111111]',
    accentBgSoft: 'bg-[#111111]/5',
    accentBorder: 'border-[#111111]',
    chip: 'bg-[#111111]/10 text-[#111111]',
    bigValue: 'text-[#111111]',
    selectedCard: 'border-[#111111] bg-[#111111]/5 ring-1 ring-[#111111]',
    dot: 'bg-[#111111]',
    accentBar: 'bg-[#111111]',
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
  ceph: {
    // Ceph 官网品牌色：红 #EF5C55
    label: 'Ceph（全闪统一存储）',
    accentText: 'text-[#C43E38]',
    accentBgSoft: 'bg-[#EF5C55]/10',
    accentBorder: 'border-[#EF5C55]',
    chip: 'bg-[#EF5C55]/15 text-[#C43E38]',
    bigValue: 'text-[#C43E38]',
    selectedCard: 'border-[#EF5C55] bg-[#EF5C55]/10 ring-1 ring-[#EF5C55]',
    dot: 'bg-[#EF5C55]',
    accentBar: 'bg-[#EF5C55]',
  },
  'ceph-hybrid': {
    // Ceph 官网品牌色（混闪用更深的暗红区分全闪）
    label: 'Ceph（混闪对象存储）',
    accentText: 'text-[#9A2E29]',
    accentBgSoft: 'bg-[#9A2E29]/10',
    accentBorder: 'border-[#9A2E29]',
    chip: 'bg-[#9A2E29]/15 text-[#9A2E29]',
    bigValue: 'text-[#9A2E29]',
    selectedCard: 'border-[#9A2E29] bg-[#9A2E29]/10 ring-1 ring-[#9A2E29]',
    dot: 'bg-[#9A2E29]',
    accentBar: 'bg-[#9A2E29]',
  },
  weka: {
    // Weka 主题色：品红紫 #A21CAF（偏红的紫，与 XSKY 的蓝紫 #704BFF 区分）
    label: 'Weka（文件系统）',
    accentText: 'text-[#A21CAF]',
    accentBgSoft: 'bg-[#A21CAF]/10',
    accentBorder: 'border-[#A21CAF]',
    chip: 'bg-[#A21CAF]/15 text-[#A21CAF]',
    bigValue: 'text-[#A21CAF]',
    selectedCard: 'border-[#A21CAF] bg-[#A21CAF]/10 ring-1 ring-[#A21CAF]',
    dot: 'bg-[#A21CAF]',
    accentBar: 'bg-[#A21CAF]',
  },
}

const STORAGE_ORDER = ['vastdata', 'gpfs-ece', 'weka', 'xeos', 'ceph', 'ceph-hybrid'] as const

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
    ceph?: { nodeCount: number; disksPerNode: number; diskSize: number; redundancy?: string; mdsNodeCount?: number };
    'ceph-hybrid'?: { nodeCount: number; disksPerNode: number; diskSize: number; redundancy?: string; cacheCount: number; cacheSizePerDisk: number };
    weka?: { dataNodeCount: number; ssdSize: number; protectionLevel: number; networkType: string; hotSpareCount?: number; nvmePerNode?: number };
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

      if (selectedStorages.has('ceph')) {
        try {
          if (manualConfig.ceph) {
            const mc = manualConfig.ceph
            newResults.ceph = buildCephResult(mc.nodeCount, mc.disksPerNode, mc.diskSize, isBinary, bandwidthUnitType, mc.redundancy, mc.mdsNodeCount)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planCeph({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            result.formatted.readBandwidth = formatBandwidth(result.performance.readBandwidth, bandwidthUnitType)
            result.formatted.writeBandwidth = formatBandwidth(result.performance.writeBandwidth, bandwidthUnitType)
            result.formatted.rgwReadBandwidth = formatBandwidth(result.rgwPerformance.readBandwidth, bandwidthUnitType)
            result.formatted.rgwWriteBandwidth = formatBandwidth(result.rgwPerformance.writeBandwidth, bandwidthUnitType)
            newResults.ceph = result
          }
        } catch (err) {
          newErrors.ceph = err instanceof Error ? err.message : 'Unknown error'
        }
      }

      if (selectedStorages.has('ceph-hybrid')) {
        try {
          if (manualConfig['ceph-hybrid']) {
            const mc = manualConfig['ceph-hybrid']
            newResults['ceph-hybrid'] = buildCephHybridResult(mc.nodeCount, mc.disksPerNode, mc.diskSize, isBinary, bandwidthUnitType, mc.redundancy, mc.cacheCount, mc.cacheSizePerDisk)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planCephHybrid({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            result.formatted.rgwReadBandwidth = formatBandwidth(result.rgwPerformance.readBandwidth, bandwidthUnitType)
            result.formatted.rgwWriteBandwidth = formatBandwidth(result.rgwPerformance.writeBandwidth, bandwidthUnitType)
            newResults['ceph-hybrid'] = result
          }
        } catch (err) {
          newErrors['ceph-hybrid'] = err instanceof Error ? err.message : 'Unknown error'
        }
      }
      if (selectedStorages.has('weka')) {
        try {
          if (manualConfig.weka) {
            const mc = manualConfig.weka
            newResults.weka = buildWekaResult(mc.dataNodeCount, mc.ssdSize, mc.protectionLevel, mc.networkType, isBinary, bandwidthUnitType, mc.hotSpareCount, mc.nvmePerNode)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planWeka({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            result.formatted.readBandwidth = formatBandwidth(result.performance.readBandwidth, bandwidthUnitType)
            result.formatted.writeBandwidth = formatBandwidth(result.performance.writeBandwidth, bandwidthUnitType)
            newResults.weka = result
          }
        } catch (err) {
          newErrors.weka = err instanceof Error ? err.message : 'Unknown error'
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

  const handleCephNodeCountChange = (newCount: number) => {
    if (!results.ceph || newCount < CEPH_CONSTANTS.MIN_NODES || newCount > CEPH_CONSTANTS.MAX_NODES) return
    const { disksPerNode, diskSize, redundancy, nodeCount, mdsNodeCount } = results.ceph
    // 增加节点数时自动选择得盘率最大的策略（即该节点数的默认策略）；
    // 减少节点数时若当前策略仍允许则保留，否则回退默认策略
    const allowed = getCephAllowedSchemes(newCount)
    const scheme = newCount > nodeCount
      ? allowed.reduce((a, b) => (b.efficiency > a.efficiency ? b : a))
      : (allowed.find(s => s.scheme === redundancy) ?? allowed[0])
    const newCapacityTiB = cephCapacity(newCount, disksPerNode, diskSize, scheme.efficiency)
    setManualConfig(prev => ({ ...prev, ceph: { nodeCount: newCount, disksPerNode, diskSize, redundancy: scheme.scheme, mdsNodeCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephMdsNodeCountChange = (newCount: number) => {
    if (!results.ceph || newCount < CEPH_CONSTANTS.MIN_MDS_NODES) return
    const { nodeCount, disksPerNode, diskSize, redundancy } = results.ceph
    setManualConfig(prev => ({ ...prev, ceph: { nodeCount, disksPerNode, diskSize, redundancy, mdsNodeCount: newCount } }))
  }

  const handleCephDisksPerNodeChange = (newDisksPerNode: number) => {
    if (!results.ceph) return
    const { nodeCount, diskSize, redundancy, efficiency, mdsNodeCount } = results.ceph
    const newCapacityTiB = cephCapacity(nodeCount, newDisksPerNode, diskSize, efficiency)
    setManualConfig(prev => ({ ...prev, ceph: { nodeCount, disksPerNode: newDisksPerNode, diskSize, redundancy, mdsNodeCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephDiskChange = (newDiskSize: number) => {
    if (!results.ceph) return
    const { nodeCount, disksPerNode, redundancy, efficiency, mdsNodeCount } = results.ceph
    const newCapacityTiB = cephCapacity(nodeCount, disksPerNode, newDiskSize, efficiency)
    setManualConfig(prev => ({ ...prev, ceph: { nodeCount, disksPerNode, diskSize: newDiskSize, redundancy, mdsNodeCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephRedundancyChange = (scheme: string) => {
    if (!results.ceph) return
    const { nodeCount, disksPerNode, diskSize, mdsNodeCount } = results.ceph
    const s = getCephAllowedSchemes(nodeCount).find(x => x.scheme === scheme)
    if (!s) return
    const newCapacityTiB = cephCapacity(nodeCount, disksPerNode, diskSize, s.efficiency)
    setManualConfig(prev => ({ ...prev, ceph: { nodeCount, disksPerNode, diskSize, redundancy: scheme, mdsNodeCount } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephHybridNodeCountChange = (newCount: number) => {
    if (!results['ceph-hybrid'] || newCount < CEPH_HYBRID_CONSTANTS.MIN_NODES || newCount > CEPH_HYBRID_CONSTANTS.MAX_NODES) return
    const { disksPerNode, diskSize, redundancy, nodeCount, cacheConfig } = results['ceph-hybrid']
    const allowed = getCephHybridAllowedSchemes(newCount)
    const scheme = newCount > nodeCount
      ? allowed.reduce((a, b) => (b.efficiency > a.efficiency ? b : a))
      : (allowed.find(s => s.scheme === redundancy) ?? allowed[0])
    const newCapacityTiB = cephHybridCapacity(newCount, disksPerNode, diskSize, scheme.efficiency)
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount: newCount, disksPerNode, diskSize, redundancy: scheme.scheme, cacheCount: cacheConfig.count, cacheSizePerDisk: cacheConfig.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephHybridDisksPerNodeChange = (newDisksPerNode: number) => {
    if (!results['ceph-hybrid']) return
    const { nodeCount, diskSize, redundancy, efficiency } = results['ceph-hybrid']
    const newCapacityTiB = cephHybridCapacity(nodeCount, newDisksPerNode, diskSize, efficiency)
    const cache = cephHybridCacheConfig(newDisksPerNode, diskSize)
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount, disksPerNode: newDisksPerNode, diskSize, redundancy, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephHybridDiskChange = (newDiskSize: number) => {
    if (!results['ceph-hybrid']) return
    const { nodeCount, disksPerNode, redundancy, efficiency } = results['ceph-hybrid']
    const newCapacityTiB = cephHybridCapacity(nodeCount, disksPerNode, newDiskSize, efficiency)
    const cache = cephHybridCacheConfig(disksPerNode, newDiskSize)
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount, disksPerNode, diskSize: newDiskSize, redundancy, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephHybridRedundancyChange = (scheme: string) => {
    if (!results['ceph-hybrid']) return
    const { nodeCount, disksPerNode, diskSize, cacheConfig } = results['ceph-hybrid']
    const s = getCephHybridAllowedSchemes(nodeCount).find(x => x.scheme === scheme)
    if (!s) return
    const newCapacityTiB = cephHybridCapacity(nodeCount, disksPerNode, diskSize, s.efficiency)
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount, disksPerNode, diskSize, redundancy: scheme, cacheCount: cacheConfig.count, cacheSizePerDisk: cacheConfig.sizePerDisk } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleCephHybridCacheCountChange = (newCount: number) => {
    if (!results['ceph-hybrid']) return
    const { nodeCount, disksPerNode, diskSize, redundancy, cacheConfig } = results['ceph-hybrid']
    const requiredCacheTB = (disksPerNode * diskSize) / CEPH_HYBRID_CONSTANTS.CACHE_RATIO
    if (newCount * cacheConfig.sizePerDisk < requiredCacheTB) return
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount, disksPerNode, diskSize, redundancy, cacheCount: newCount, cacheSizePerDisk: cacheConfig.sizePerDisk } }))
  }

  const handleCephHybridCacheSizeChange = (newSize: number) => {
    if (!results['ceph-hybrid']) return
    const { nodeCount, disksPerNode, diskSize, redundancy, cacheConfig } = results['ceph-hybrid']
    const requiredCacheTB = (disksPerNode * diskSize) / CEPH_HYBRID_CONSTANTS.CACHE_RATIO
    if (cacheConfig.count * newSize < requiredCacheTB) return
    setManualConfig(prev => ({ ...prev, 'ceph-hybrid': { nodeCount, disksPerNode, diskSize, redundancy, cacheCount: cacheConfig.count, cacheSizePerDisk: newSize } }))
  }

  const handleWekaDataNodeCountChange = (newCount: number) => {
    if (!results.weka || newCount < WEKA_CONSTANTS.MIN_TOTAL_NODES - WEKA_CONSTANTS.HOT_SPARE) return
    const { ssdSize, protectionLevel, networkType, hotSpareCount, nvmePerNode } = results.weka
    // 数据节点 ≥ 100 台时自动升级保护级别为 4；回落到 100 台以下时保留当前选择
    const newLevel = newCount >= 100 ? 4 : protectionLevel
    try {
      const newCapacityTiB = wekaCapacity(newCount, ssdSize, newLevel, nvmePerNode)
      setManualConfig(prev => ({ ...prev, weka: { dataNodeCount: newCount, ssdSize, protectionLevel: newLevel, networkType, hotSpareCount, nvmePerNode } }))
      setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
    } catch { /* 无效节点数忽略 */ }
  }

  const handleWekaHotSpareChange = (newHotSpare: number) => {
    if (!results.weka || newHotSpare < 0) return
    const { dataNodeCount, ssdSize, protectionLevel, networkType, nvmePerNode } = results.weka
    setManualConfig(prev => ({ ...prev, weka: { dataNodeCount, ssdSize, protectionLevel, networkType, hotSpareCount: newHotSpare, nvmePerNode } }))
  }

  const handleWekaDiskChange = (newSsdSize: number) => {
    if (!results.weka) return
    const { dataNodeCount, protectionLevel, networkType, hotSpareCount, nvmePerNode } = results.weka
    const newCapacityTiB = wekaCapacity(dataNodeCount, newSsdSize, protectionLevel, nvmePerNode)
    setManualConfig(prev => ({ ...prev, weka: { dataNodeCount, ssdSize: newSsdSize, protectionLevel, networkType, hotSpareCount, nvmePerNode } }))
    setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  const handleWekaProtectionChange = (newLevel: number) => {
    if (!results.weka) return
    const { dataNodeCount, ssdSize, networkType, hotSpareCount, nvmePerNode } = results.weka
    try {
      const newCapacityTiB = wekaCapacity(dataNodeCount, ssdSize, newLevel, nvmePerNode)
      setManualConfig(prev => ({ ...prev, weka: { dataNodeCount, ssdSize, protectionLevel: newLevel, networkType, hotSpareCount, nvmePerNode } }))
      setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
    } catch { /* 无效保护级别忽略 */ }
  }

  const handleWekaNetworkChange = (newNetwork: string) => {
    if (!results.weka) return
    const { dataNodeCount, ssdSize, protectionLevel, hotSpareCount, nvmePerNode } = results.weka
    setManualConfig(prev => ({ ...prev, weka: { dataNodeCount, ssdSize, protectionLevel, networkType: newNetwork, hotSpareCount, nvmePerNode } }))
  }

  const handleWekaNvmeCountChange = (newNvmeCount: number) => {
    if (!results.weka) return
    const { dataNodeCount, ssdSize, protectionLevel, networkType, hotSpareCount } = results.weka
    const newCapacityTiB = wekaCapacity(dataNodeCount, ssdSize, protectionLevel, newNvmeCount)
    setManualConfig(prev => ({ ...prev, weka: { dataNodeCount, ssdSize, protectionLevel, networkType, hotSpareCount, nvmePerNode: newNvmeCount } }))
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
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

        {!hasSelection && <SelectionGuide onSelect={toggleStorage} />}

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

          {selectedStorages.has('weka') && (
            <div>
              <StorageInfo storage="weka" />
              {errors.weka && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors.weka}</p>
                </div>
              )}
              {results.weka && (
                <WekaResult data={results.weka} onDataNodeCountChange={handleWekaDataNodeCountChange} onHotSpareChange={handleWekaHotSpareChange} onDiskChange={handleWekaDiskChange} onNvmeCountChange={handleWekaNvmeCountChange} onProtectionChange={handleWekaProtectionChange} onNetworkChange={handleWekaNetworkChange} />
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
          {selectedStorages.has('ceph') && (
            <div>
              <StorageInfo storage="ceph" />
              {errors.ceph && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors.ceph}</p>
                </div>
              )}
              {results.ceph && (
                <CephResult data={results.ceph} onNodeCountChange={handleCephNodeCountChange} onMdsNodeCountChange={handleCephMdsNodeCountChange} onDisksPerNodeChange={handleCephDisksPerNodeChange} onDiskChange={handleCephDiskChange} onRedundancyChange={handleCephRedundancyChange} />
              )}
            </div>
          )}
          {selectedStorages.has('ceph-hybrid') && (
            <div>
              <StorageInfo storage="ceph-hybrid" />
              {errors['ceph-hybrid'] && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                  <p className="text-red-800">{errors['ceph-hybrid']}</p>
                </div>
              )}
              {results['ceph-hybrid'] && (
                <CephHybridResult data={results['ceph-hybrid']} onNodeCountChange={handleCephHybridNodeCountChange} onDisksPerNodeChange={handleCephHybridDisksPerNodeChange} onDiskChange={handleCephHybridDiskChange} onRedundancyChange={handleCephHybridRedundancyChange} onCacheCountChange={handleCephHybridCacheCountChange} onCacheSizeChange={handleCephHybridCacheSizeChange} />
              )}
            </div>
          )}
        </div>

        <footer className="text-center text-sm text-gray-400 mt-12 pb-8 space-y-1">
          <div>
            <a href="https://github.com/wutz/storplan" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">
              GitHub: wutz/storplan
            </a>
          </div>
          <div className="text-xs">构建时间：{__BUILD_TIME__}（Asia/Shanghai）</div>
        </footer>
      </div>
    </div>
  )
}

// 存储选型参考（迁移自 infra-skills / storage-planner-router）
type GuideRow = {
  key?: string // 对应本工具中的方案 key，可点击选择
  name: string
  pros: string
  cons: string
  scenarios: string
}

const SELECTION_GUIDE: { title: string; rows: GuideRow[]; notes?: string[] }[] = [
  {
    title: '高性能文件系统',
    rows: [
      {
        key: 'gpfs-ece',
        name: 'GPFS ECE',
        pros: '高性能，广泛使用，软件授权费用低',
        cons: '不支持多租户（需为每个租户单独建设），缺少原厂技术支持（第三方技术支持不足）',
        scenarios: '单租户高性能场景，预算有限',
      },
      {
        key: 'vastdata',
        name: 'VastData',
        pros: '支持多种存储协议可平替 Ceph，支持多租户，支持 QoS，支持去重建设成本低（平摊下软件授权费用），原厂技术支持',
        cons: '性能比 GPFS ECE 稍弱，采购周期较长',
        scenarios: '多租户场景，需要 QoS 和技术支持',
      },
      {
        key: 'weka',
        name: 'Weka',
        pros: '比 GPFS ECE 性能更高，支持多租户',
        cons: '软件授权费用高，缺少原厂技术支持',
        scenarios: '极致性能需求，预算充足',
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
        pros: '功能齐全，支持 QoS，原厂技术支持，支持大规模，稳定',
        cons: '软件授权费用高',
        scenarios: '生产环境，需要稳定性和技术支持',
      },
      {
        key: 'ceph-hybrid',
        name: 'Ceph RGW',
        pros: '开源无软件授权费用',
        cons: '相比 XSKY XEOS 稳定性欠缺，QoS 较弱，海量对象数稳定性未验证，无技术支持',
        scenarios: '预算有限，非关键业务',
      },
      {
        key: 'vastdata',
        name: 'VastData S3',
        pros: '高性能，与文件系统复用一个存储集群，支持 QoS，原厂技术支持，支持大规模',
        cons: '由于采用全闪成本高只适合高性能场景',
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
        pros: '高性能，原厂技术支持',
        cons: '当前版本还未支持 QoS',
        scenarios: '高性能块存储需求，可接受新产品',
      },
      {
        key: 'ceph',
        name: 'Ceph RBD',
        pros: '开源无软件授权费用，块存储系统成熟',
        cons: '全闪配置性能普通，无技术支持',
        scenarios: '预算有限，虚拟机/数据库等通用块存储',
      },
    ],
  },
]

function SelectionGuide({ onSelect }: { onSelect: (key: string) => void }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6 sm:p-8">
      <div className="mb-6 text-center">
        <h3 className="text-base font-semibold text-gray-900">存储选型参考</h3>
        <p className="mt-1 text-sm text-gray-500">根据存储类型对比各方案优缺点，点击方案名称开始容量与性能规划。</p>
      </div>
      <div className="space-y-8">
        {SELECTION_GUIDE.map((section) => (
          <div key={section.title}>
            <h4 className="text-sm font-semibold text-gray-800 mb-3">{section.title}</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">方案</th>
                    <th className="py-2 pr-4 font-medium">优点</th>
                    <th className="py-2 pr-4 font-medium">缺点</th>
                    <th className="py-2 font-medium">适用场景</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => {
                    const t = row.key ? THEME[row.key] : undefined
                    return (
                      <tr key={row.name} className="border-b border-gray-100 align-top">
                        <td className="py-2.5 pr-4 whitespace-nowrap">
                          {row.key && t ? (
                            <button
                              type="button"
                              onClick={() => onSelect(row.key!)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${t.chip} hover:opacity-80 transition`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
                              {row.name}
                            </button>
                          ) : (
                            <span className="font-medium text-gray-700">{row.name}</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600">{row.pros}</td>
                        <td className="py-2.5 pr-4 text-gray-600">{row.cons}</td>
                        <td className="py-2.5 text-gray-600">{row.scenarios}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {section.notes && section.notes.map((n, i) => (
              <p key={i} className="mt-2 text-xs text-gray-400">注：{n}</p>
            ))}
          </div>
        ))}
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
  ceph: {
    description: 'Ceph 是开源分布式统一存储系统，本方案为全闪配置，单一集群同时提供块、对象和文件存储服务。',
    pros: [
      '开源软件，无需购买软件授权',
      '支持多租户',
      '统一存储：支持块、对象存储和文件系统',
      '块存储系统成熟',
      '支持同一集群使用不同容量磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '每盘容量均衡度低，总可用容量进一步锐减，通常按 70% 计算',
      '全闪配置性能普通，有高性能需求时需要堆盘',
      '文件系统元数据缓存上限受节点内存大小限制，不足时性能锐减',
      '文件系统元数据需要额外配置多个大内存节点',
      '文件系统运维成本高',
      'CephFS 不支持 QoS，Ceph RGW 的 QoS 较弱',
      '无技术支持',
    ],
    limits: [
      '文件系统热数据数量不建议超过 5 千万（大约消耗 200G 内存）',
      '文件系统不建议应用于 AI 场景',
    ],
  },
  'ceph-hybrid': {
    description: 'Ceph 混闪配置基于大量 HDD 和少量 NVMe SSD 构建，混闪下仅建议配置为对象存储 Ceph RGW，适合海量非结构化数据低成本存储。',
    pros: [
      '开源软件，无需购买软件授权',
      '支持多租户',
      '大容量 HDD 硬件成本低',
      '支持同一集群使用不同容量磁盘',
    ],
    cons: [
      '不支持折叠纠删码，起步节点少时得盘率低',
      '每盘容量均衡度低，总可用容量进一步锐减，通常按 70% 计算',
      'Ceph RGW 的 QoS 较弱',
      '无技术支持',
    ],
    limits: [
      '混闪配置仅建议用作对象存储（Ceph RGW），不建议配置块存储和文件系统',
    ],
  },
  weka: {
    description: 'Weka（WekaFS）是高性能并行文件系统，基于 NVMe SSD 和高速网络构建全闪架构，适合 AI/HPC 等高性能场景。',
    pros: ['性能极高，已知存储系统中最高性能', '支持分层到对象存储实现低成本混闪文件系统', '支持多租户', '支持QoS'],
    cons: ['软件授权费用较高', '第三方厂商技术支持'],
    limits: ['条带宽度 D+P 限制在 5–20 之间，且 D 必须大于 P'],
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
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'
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
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'
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
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'
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
              <dd>2 × 960GB SATA SSD（RAID1）</dd>
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

function CephResult({ data, onNodeCountChange, onMdsNodeCountChange, onDisksPerNodeChange, onDiskChange, onRedundancyChange }: {
  data: CephPlanResult;
  onNodeCountChange: (n: number) => void;
  onMdsNodeCountChange: (n: number) => void;
  onDisksPerNodeChange: (n: number) => void;
  onDiskChange: (n: number) => void;
  onRedundancyChange: (s: string) => void;
}) {
  const t = THEME.ceph
  const totalDisks = data.nodeCount * data.disksPerNode
  const effectiveRate = data.actualCapacity / data.rawCapacity
  const mem = getCephMemory(data.disksPerNode)
  const storageNet = getCephStorageNetwork(data.disksPerNode)
  const mdsMem = getCephMdsMemory()
  const mdsStorageNet = getCephMdsStorageNetwork(data.disksPerNode)
  const perDisk = getCephPerDisk(data.redundancy)
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <h2 className="text-xl font-bold text-gray-900 mb-4">Ceph 规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">数据节点数量</dt>
                <dd className="flex items-center gap-1">
                  <button onClick={() => onNodeCountChange(data.nodeCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.nodeCount <= 3}>−</button>
                  <NumberInput
                    value={data.nodeCount}
                    onChange={onNodeCountChange}
                    min={3}
                    className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                  />
                  <button onClick={() => onNodeCountChange(data.nodeCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                  <span className="ml-0.5">台</span>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">元数据节点数量（仅 CephFS 需要）</dt>
                <dd className="flex items-center gap-1">
                  <button onClick={() => onMdsNodeCountChange(data.mdsNodeCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.mdsNodeCount <= CEPH_CONSTANTS.MIN_MDS_NODES}>−</button>
                  <NumberInput
                    value={data.mdsNodeCount}
                    onChange={onMdsNodeCountChange}
                    min={CEPH_CONSTANTS.MIN_MDS_NODES}
                    className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                  />
                  <button onClick={() => onMdsNodeCountChange(data.mdsNodeCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                  <span className="ml-0.5">台</span>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">数据冗余策略</dt>
                <dd className="flex items-center gap-1">
                  <select value={data.redundancy} onChange={(e) => onRedundancyChange(e.target.value)} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                    {getCephAllowedSchemes(data.nodeCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}{s.notRecommended ? '（生产环境不建议）' : ''}</option>)}
                  </select>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">冗余得盘率</dt>
                <dd>{(data.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">容错能力</dt>
                <dd>容忍 {data.tolerance} 台节点离线</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">集群磁盘总数</dt>
                <dd>{totalDisks.toLocaleString()} 块</dd>
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
              <div className="flex justify-between text-xs text-gray-400">
                <dt>综合得盘率</dt>
                <dd>{(effectiveRate * 100).toFixed(1)}%（含预留 1 节点 × 均衡损失 70%）</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台数据节点配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>{mem.dimmCount} × {mem.dimmSizeGB}GB DDR5 4800（共 {mem.totalGB}GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 960GB SATA SSD（RAID1）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">存储网络</dt>
              <dd>{storageNet.label}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">管理网络（可选）</dt>
              <dd>1 × 双口 25Gb 以太网卡</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd className="flex items-center gap-1">
                <select value={data.disksPerNode} onChange={(e) => onDisksPerNodeChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {CEPH_CONSTANTS.DISKS_PER_NODE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {CEPH_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>NVMe SSD（TLC）</span>
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台元数据节点配置（仅 CephFS 需要，共 {data.mdsNodeCount} 台）</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>{mdsMem.dimmCount} × {mdsMem.dimmSizeGB}GB DDR5 4800（共 {mdsMem.totalGB}GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 960GB SATA SSD（RAID1）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">存储网络</dt>
              <dd>{mdsStorageNet.label}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">管理网络（可选）</dt>
              <dd>1 × 双口 25Gb 以太网卡</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">数据盘</dt>
              <dd>无</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">性能（CephFS / RBD 预测数据）</h3>
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
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">性能（RGW 对象存储预测数据）</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">读 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteOPS}</dd>
            </div>
          </dl>
        </div>
        <div className="text-xs text-gray-400 space-y-0.5">
          <div>容量计算：(节点数 − 1) × 冗余得盘率 × 单节点盘数 × 单盘容量 × 0.7（数据均衡损失）</div>
          <div>性能计算：集群盘总数 × 每盘平均性能（{data.redundancy}：读 {perDisk.readMiBps} MiB/s、写 {perDisk.writeMiBps} MiB/s、读 IOPS {(perDisk.readIOPS / 1000)}k、写 IOPS {(perDisk.writeIOPS / 1000)}k）</div>
          <div>RGW 每盘平均性能：读 {CEPH_RGW_PER_DISK.readMiBps} MiB/s、写 {CEPH_RGW_PER_DISK.writeMiBps} MiB/s、读 OPS {CEPH_RGW_PER_DISK.readOPS}、写 OPS {CEPH_RGW_PER_DISK.writeOPS}</div>
        </div>
      </div>
    </div>
  )
}

function CephHybridResult({ data, onNodeCountChange, onDisksPerNodeChange, onDiskChange, onRedundancyChange, onCacheCountChange, onCacheSizeChange }: {
  data: CephHybridPlanResult;
  onNodeCountChange: (n: number) => void;
  onDisksPerNodeChange: (n: number) => void;
  onDiskChange: (n: number) => void;
  onRedundancyChange: (s: string) => void;
  onCacheCountChange: (n: number) => void;
  onCacheSizeChange: (n: number) => void;
}) {
  const t = THEME['ceph-hybrid']
  const totalDisks = data.nodeCount * data.disksPerNode
  const effectiveRate = data.actualCapacity / data.rawCapacity
  const requiredCacheTB = (data.disksPerNode * data.diskSize) / CEPH_HYBRID_CONSTANTS.CACHE_RATIO
  const isCacheSufficient = data.cacheConfig.totalSize >= requiredCacheTB
  const perTiBReadBW = data.rgwPerformance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <h2 className="text-xl font-bold text-gray-900 mb-4">Ceph（混闪对象存储）规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">数据节点数量</dt>
                <dd className="flex items-center gap-1">
                  <button onClick={() => onNodeCountChange(data.nodeCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.nodeCount <= 3}>−</button>
                  <NumberInput
                    value={data.nodeCount}
                    onChange={onNodeCountChange}
                    min={3}
                    className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                  />
                  <button onClick={() => onNodeCountChange(data.nodeCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                  <span className="ml-0.5">台</span>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">数据冗余策略</dt>
                <dd className="flex items-center gap-1">
                  <select value={data.redundancy} onChange={(e) => onRedundancyChange(e.target.value)} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                    {getCephHybridAllowedSchemes(data.nodeCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}{s.notRecommended ? '（生产环境不建议）' : ''}</option>)}
                  </select>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">冗余得盘率</dt>
                <dd>{(data.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">容错能力</dt>
                <dd>容忍 {data.tolerance} 台节点离线</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">集群 HDD 总数</dt>
                <dd>{totalDisks.toLocaleString()} 块</dd>
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
              <div className="flex justify-between text-xs text-gray-400">
                <dt>综合得盘率</dt>
                <dd>{(effectiveRate * 100).toFixed(1)}%（含预留 1 节点 × 均衡损失 70%）</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台数据节点配置（混闪）</h3>
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
                <select value={data.disksPerNode} onChange={(e) => onDisksPerNodeChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {CEPH_HYBRID_CONSTANTS.DISKS_PER_NODE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {CEPH_HYBRID_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>HDD</span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">索引盘</dt>
              <dd className="flex items-center gap-1">
                <select value={data.cacheConfig.count} onChange={(e) => onCacheCountChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {[1, 2, 3, 4].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.cacheConfig.sizePerDisk} onChange={(e) => onCacheSizeChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {CEPH_HYBRID_CONSTANTS.CACHE_DISK_SIZES.map(s => <option key={s} value={s}>{s}TB</option>)}
                </select>
                <span className="text-xs">NVMe SSD</span>
                {!isCacheSufficient && <span className="text-red-600 text-xs">⚠️ 不足</span>}
              </dd>
            </div>
            <div className="flex justify-between text-xs text-gray-400">
              <dt>索引盘容量要求</dt>
              <dd>≥ {requiredCacheTB.toFixed(2)}TB（实际 {data.cacheConfig.totalSize.toFixed(2)}TB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">网卡</dt>
              <dd>2 × 双口 25Gb ETH NIC</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">性能（RGW 对象存储预测数据）</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">读 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 BW (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-gray-500">每 TiB 读 BW (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-gray-500">读 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadOPS}</dd>
            </div>
            <div>
              <dt className="text-gray-500">写 OPS (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteOPS}</dd>
            </div>
          </dl>
        </div>
        <div className="text-xs text-gray-400 space-y-0.5">
          <div>容量计算：(节点数 − 1) × 冗余得盘率 × 单节点盘数 × 单盘容量 × 0.7（数据均衡损失）</div>
          <div>RGW 每 HDD 平均性能：读 {RGW_HYBRID_PER_DISK.readMiBps} MiB/s、写 {RGW_HYBRID_PER_DISK.writeMiBps} MiB/s、读 OPS {RGW_HYBRID_PER_DISK.readOPS}、写 OPS {RGW_HYBRID_PER_DISK.writeOPS}</div>
        </div>
      </div>
    </div>
  )
}

function WekaResult({ data, onDataNodeCountChange, onHotSpareChange, onDiskChange, onNvmeCountChange, onProtectionChange, onNetworkChange }: {
  data: WekaPlanResult;
  onDataNodeCountChange: (n: number) => void;
  onHotSpareChange: (n: number) => void;
  onDiskChange: (n: number) => void;
  onNvmeCountChange: (n: number) => void;
  onProtectionChange: (n: number) => void;
  onNetworkChange: (s: string) => void;
}) {
  const t = THEME.weka
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'
  const minDataNodes = WEKA_CONSTANTS.MIN_TOTAL_NODES - WEKA_CONSTANTS.HOT_SPARE

  return (
    <div className="relative overflow-hidden bg-white rounded-2xl shadow-sm ring-1 ring-gray-200/70 p-6">
      <span className={`absolute inset-x-0 top-0 h-1 ${t.accentBar}`} />
      <h2 className="text-xl font-bold text-gray-900 mb-4">Weka 规划方案</h2>
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold text-gray-700 mb-2">集群配置</h3>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">总台数</dt>
                <dd>{data.nodeCount} 台</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">数据节点数量</dt>
                <dd className="flex items-center gap-1">
                  <button onClick={() => onDataNodeCountChange(data.dataNodeCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.dataNodeCount <= minDataNodes}>−</button>
                  <NumberInput
                    value={data.dataNodeCount}
                    onChange={onDataNodeCountChange}
                    min={minDataNodes}
                    className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                  />
                  <button onClick={() => onDataNodeCountChange(data.dataNodeCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                  <span className="ml-0.5">台</span>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">热备节点数量</dt>
                <dd className="flex items-center gap-1">
                  <button onClick={() => onHotSpareChange(data.hotSpareCount - 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs" disabled={data.hotSpareCount <= 0}>−</button>
                  <NumberInput
                    value={data.hotSpareCount}
                    onChange={onHotSpareChange}
                    min={0}
                    className="w-14 text-center border border-gray-200 rounded px-1 py-0.5 text-sm"
                  />
                  <button onClick={() => onHotSpareChange(data.hotSpareCount + 1)} className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-xs">+</button>
                  <span className="ml-0.5">台</span>
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-gray-500">保护级别 (P)</dt>
                <dd>
                  <select value={data.protectionLevel} onChange={(e) => onProtectionChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                    {WEKA_CONSTANTS.PROTECTION_LEVELS.map(p => <option key={p} value={p}>+{p}</option>)}
                  </select>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">纠删码方案</dt>
                <dd>{data.protection.scheme}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">得盘率</dt>
                <dd>{(data.protection.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">容错能力</dt>
                <dd>容忍 {data.protection.P} 台节点离线</dd>
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
              <div className="flex justify-between text-xs text-gray-400">
                <dt>说明</dt>
                <dd>含 10% 元数据与系统保留，热备节点不计容量</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">每台服务器配置</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">处理器</dt>
              <dd>2 × Intel Xeon 5418Y</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">内存</dt>
              <dd>12 × 32GB DDR5（共 384GB）</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">系统盘</dt>
              <dd>2 × 960GB SATA SSD（RAID1）</dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">数据盘</dt>
              <dd className="flex items-center gap-1">
                <select value={data.nvmePerNode} onChange={(e) => onNvmeCountChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {WEKA_CONSTANTS.NVME_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.ssdSize} onChange={(e) => onDiskChange(Number(e.target.value))} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  {WEKA_CONSTANTS.SSD_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>NVMe SSD</span>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-gray-500">存储网络</dt>
              <dd>
                <select value={data.networkType} onChange={(e) => onNetworkChange(e.target.value)} className="border border-gray-200 rounded px-1.5 py-0.5 text-sm">
                  <option value="100gb">2 × 双口 100Gb IB/RoCE/Eth NIC</option>
                  <option value="200gb">2 × 双口 200Gb IB/RoCE/Eth NIC</option>
                </select>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">管理网络</dt>
              <dd>1 × 双口 25Gb 以太网卡</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-semibold text-gray-700 mb-2">性能（预测数据，含热备节点）</h3>
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
