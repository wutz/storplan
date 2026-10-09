/**
 * 首页：存储方案选型、参数表单和结果卡片。
 * 计算全部委托给 #/lib 下的规划器，这里只负责收集参数、展示结果，
 * 以及处理结果卡上「改一个数就地重算」的交互。
 */
import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { planXEOS, buildXEOSResult, buildUltraLargeFromServers, getAllowedEcSchemes, calculatePoolConfig as xeosPoolConfig, CONSTANTS as XEOS_CONSTANTS, EC_SCHEMES as XEOS_EC_SCHEMES, calculateCapacityTiB as xeosCapacity, calculateCacheConfig as xeosCacheConfig } from '#/lib/xeos'
import type { XEOSPlanResult } from '#/lib/xeos'
import { planVastData, buildVastDataResult, CONSTANTS as VAST_CONSTANTS, calculateCapacityTiB as vastCapacity } from '#/lib/vastdata'
import type { VastDataPlanResult } from '#/lib/vastdata'
import { planGPFSECE, buildGPFSECEResult, getECScheme as getGpfsEcScheme, getGPFSTolerance, getAllowedECSchemes, CONSTANTS as GPFS_CONSTANTS, EC_SCHEMES as GPFS_EC_SCHEMES, calculateCapacityTiB as gpfsCapacity } from '#/lib/gpfs-ece'
import type { GPFSECEPlanResult } from '#/lib/gpfs-ece'
import { planGPFSHybrid, buildGPFSHybridResult, getBestECScheme as getGpfsHybridBestEc, getAllowedECSchemes as getGpfsHybridAllowedSchemes, calculateCacheConfig as gpfsHybridCacheConfig, getCacheRequirement as gpfsHybridCacheRequirement, calculateCapacityTiB as gpfsHybridCapacity, getAllowedNetworkTypes as getGpfsHybridAllowedNetworkTypes, REPORT_BASELINE as GPFS_HYBRID_BASELINE, CONSTANTS as GPFS_HYBRID_CONSTANTS } from '#/lib/gpfs-hybrid'
import type { GPFSHybridPlanResult } from '#/lib/gpfs-hybrid'
import { planCeph, buildCephResult, getMemoryConfig as getCephMemory, getStorageNetworkConfig as getCephStorageNetwork, getMdsMemoryConfig as getCephMdsMemory, getMdsStorageNetworkConfig as getCephMdsStorageNetwork, getPerDiskPerformance as getCephPerDisk, getAllowedRedundancySchemes as getCephAllowedSchemes, RGW_PER_DISK as CEPH_RGW_PER_DISK, calculateCapacityTiB as cephCapacity, CONSTANTS as CEPH_CONSTANTS } from '#/lib/ceph'
import type { CephPlanResult } from '#/lib/ceph'
import { planCephHybrid, buildCephHybridResult, calculateCacheConfig as cephHybridCacheConfig, calculateCapacityTiB as cephHybridCapacity, getAllowedRedundancySchemes as getCephHybridAllowedSchemes, RGW_HYBRID_PER_DISK, CONSTANTS as CEPH_HYBRID_CONSTANTS } from '#/lib/ceph-hybrid'
import type { CephHybridPlanResult } from '#/lib/ceph-hybrid'
import { planWeka, buildWekaResult, calculateCapacityTiB as wekaCapacity, CONSTANTS as WEKA_CONSTANTS } from '#/lib/weka'
import type { WekaPlanResult } from '#/lib/weka'
import { formatBandwidth, formatCapacity, MIB_TO_MB } from '#/lib/utils'
import { localizeCatalog, STORAGE_ORDER } from '#/lib/storage-catalog'
import type { GuideRow, StorageKey } from '#/lib/storage-catalog'
import { AiAssistant, openAiAssistant } from '#/components/ai-assistant'
import { planSignature } from '#/lib/ai-chat'
import type { PlanDirective } from '#/lib/ai-chat'
import { usePrefs, tr } from '#/lib/i18n'
import { PrefsSwitcher } from '#/components/prefs-switcher'

export const Route = createFileRoute('/')({ component: StorplanApp })

type PlanResults = {
  xeos?: XEOSPlanResult
  vastdata?: VastDataPlanResult
  'gpfs-ece'?: GPFSECEPlanResult
  'gpfs-hybrid'?: GPFSHybridPlanResult
  ceph?: CephPlanResult
  'ceph-hybrid'?: CephHybridPlanResult
  weka?: WekaPlanResult
}

// 每个存储产品的官网品牌色：只用于小圆点标识，其余界面保持黑白灰
type Text = { zh: string; en: string }
type Theme = {
  /** 选择卡上的完整名称（含类型说明） */
  label: Text
  /** 方案卡头的短名称 */
  title: Text
  category: Text
  /** 品牌色（十六进制），用于圆点标识 */
  color: string
}

const THEME: Record<string, Theme> = {
  vastdata: { label: { zh: 'VastData（统一存储）', en: 'VastData (unified storage)' }, title: { zh: 'VastData（全闪）', en: 'VastData (all-flash)' }, category: { zh: '文件 · 对象 · 块', en: 'File · Object · Block' }, color: '#1FD9FE' }, // VastData 官网品牌色：亮青 #1FD9FE 配深藏蓝文字 #0D1021
  'gpfs-ece': { label: { zh: 'GPFS/Scale（文件系统）', en: 'GPFS/Scale (file system)' }, title: { zh: 'GPFS/Scale（全闪）', en: 'GPFS/Scale (all-flash)' }, category: { zh: '并行文件系统', en: 'Parallel file system' }, color: '#0F62FE' }, // IBM 官网品牌色：IBM 蓝 #0F62FE
  'gpfs-hybrid': { label: { zh: 'GPFS/Scale 混闪（文件系统）', en: 'GPFS/Scale hybrid (file system)' }, title: { zh: 'GPFS/Scale（混闪）', en: 'GPFS/Scale (hybrid)' }, category: { zh: '混闪并行文件系统', en: 'Hybrid parallel file system (flash + HDD)' }, color: '#002D9C' }, // IBM 官网品牌色（混闪用更深的 IBM Blue 80 区分全闪）
  xeos: { label: { zh: 'XSKY XEOS（对象存储）', en: 'XSKY XEOS (object storage)' }, title: { zh: 'XSKY XEOS（混闪）', en: 'XSKY XEOS (hybrid)' }, category: { zh: '对象存储', en: 'Object storage' }, color: '#7855FA' }, // XSKY 官网品牌色：星辰紫 #7855FA
  ceph: { label: { zh: 'Ceph（全闪统一存储）', en: 'Ceph (all-flash unified storage)' }, title: { zh: 'Ceph（全闪）', en: 'Ceph (all-flash)' }, category: { zh: '块 · 对象 · 文件', en: 'Block · Object · File' }, color: '#EF5C55' }, // Ceph 官网品牌色：红 #EF5C55
  'ceph-hybrid': { label: { zh: 'Ceph（混闪对象存储）', en: 'Ceph (hybrid object storage)' }, title: { zh: 'Ceph（混闪）', en: 'Ceph (hybrid)' }, category: { zh: '混闪对象存储', en: 'Hybrid object storage (flash + HDD)' }, color: '#9A2E29' }, // Ceph 官网品牌色（混闪用更深的暗红区分全闪）
  weka: { label: { zh: 'Weka（文件系统）', en: 'Weka (file system)' }, title: { zh: 'Weka（全闪）', en: 'Weka (all-flash)' }, category: { zh: '并行文件系统', en: 'Parallel file system' }, color: '#7C03EC' }, // Weka 官网品牌色：紫罗兰 #7C03EC
}

// 冗余方案名只用于显示：'3 副本' 这类标识值在英文界面下显示为 '3× replica'，option 的 value 保持原样
function schemeLabel(s: string, t: (zh: string, en: string) => string): string {
  return t(s, s.replace(/^(\d+) ?副本$/, '$1× replica'))
}

// 品牌色圆点
function BrandDot({ color, className = 'h-2 w-2' }: { color: string; className?: string }) {
  return <span aria-hidden className={`shrink-0 rounded-full ${className}`} style={{ backgroundColor: color }} />
}

// 勾选指示图标（用于方案选择卡片）
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path d="M2.5 6.2 5 8.7l4.5-4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// 告警图标（替代 emoji，保持 DESIGN.md 的中性技术调性）
function WarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path d="M6 1.4 11 10.6H1L6 1.4Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M6 4.9v2.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <circle cx="6" cy="9" r="0.6" fill="currentColor" />
    </svg>
  )
}

// 折叠指示箭头（展开时旋转 180°）
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 1.5l1.3 3.7a2 2 0 0 0 1.2 1.2L14.2 8l-3.7 1.3a2 2 0 0 0-1.2 1.2L8 14.2l-1.3-3.7a2 2 0 0 0-1.2-1.2L1.8 8l3.7-1.3a2 2 0 0 0 1.2-1.2L8 1.5z" />
    </svg>
  )
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

function NumberInput({ value, onChange, min, max, disabled, className, label }: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  /** 无可见 label 时提供可访问名称 */
  label?: string;
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
      aria-label={label}
      className={className}
    />
  )
}

// 数量步进器：−/+ 按钮 + 数字输入，配可访问名称（DESIGN.md form-input-sm 尺度）
function Stepper({ label, value, unit, onChange, min, max }: {
  label: string;
  value: number;
  unit?: string;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  const { t } = usePrefs()
  return (
    <dd className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className="stepper-btn"
        disabled={min !== undefined && value <= min}
        aria-label={t(`减少${label}`, `Decrease ${label}`)}
      >
        −
      </button>
      <NumberInput value={value} onChange={onChange} min={min} max={max} label={label} className="w-16 text-center field" />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="stepper-btn"
        disabled={max !== undefined && value >= max}
        aria-label={t(`增加${label}`, `Increase ${label}`)}
      >
        +
      </button>
      {unit && <span className="ml-0.5">{unit}</span>}
    </dd>
  )
}

function StorplanApp() {
  const { lang, t } = usePrefs()
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
    'gpfs-hybrid'?: { nodeCount: number; hddPerNode: number; hddSize: number; ecScheme?: string; cacheCount: number; cacheSizePerDisk: number; networkType: string; networkSpeed: number };
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
          newErrors.xeos = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
          newErrors.vastdata = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
          newErrors['gpfs-ece'] = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
        }
      }

      if (selectedStorages.has('gpfs-hybrid')) {
        try {
          if (manualConfig['gpfs-hybrid']) {
            const mc = manualConfig['gpfs-hybrid']
            newResults['gpfs-hybrid'] = buildGPFSHybridResult(mc.nodeCount, mc.hddPerNode, mc.hddSize, isBinary, bandwidthUnitType, mc.ecScheme, mc.cacheCount, mc.cacheSizePerDisk, mc.networkType, mc.networkSpeed)
          } else {
            const readBW = downloadBWValue ? `${downloadBWValue}${bwUnit}` : ''
            const writeBW = uploadBWValue ? `${uploadBWValue}${bwUnit}` : ''
            const result = planGPFSHybrid({ capacity, readBandwidth: readBW || undefined, writeBandwidth: writeBW || undefined })
            for (const tier of ['tiered', 'hddOnly'] as const) {
              result.formatted[tier].readBandwidth = formatBandwidth(result.performance[tier].readBandwidth, bandwidthUnitType)
              result.formatted[tier].writeBandwidth = formatBandwidth(result.performance[tier].writeBandwidth, bandwidthUnitType)
            }
            newResults['gpfs-hybrid'] = result
          }
        } catch (err) {
          newErrors['gpfs-hybrid'] = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
          newErrors.ceph = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
          newErrors['ceph-hybrid'] = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
          newErrors.weka = err instanceof Error ? err.message : tr('未知错误', 'Unknown error')
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
    ? { read: t('下载带宽', 'Download bandwidth'), write: t('上传带宽', 'Upload bandwidth') }
    : { read: t('读带宽', 'Read bandwidth'), write: t('写带宽', 'Write bandwidth') }

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

  /**
   * GPFS 混闪：把当前结果连同本次改动写回手动配置。
   * 所有可调项（含存储网络）都从结果里带出，避免逐个 handler 重复列举字段。
   */
  const patchGpfsHybrid = (
    patch: Partial<{ nodeCount: number; hddPerNode: number; hddSize: number; ecScheme: string; cacheCount: number; cacheSizePerDisk: number; networkType: string; networkSpeed: number }>,
    newCapacityTiB?: number
  ) => {
    const r = results['gpfs-hybrid']
    if (!r) return
    setManualConfig(prev => ({
      ...prev,
      'gpfs-hybrid': {
        nodeCount: r.nodeCount,
        hddPerNode: r.hddPerNode,
        hddSize: r.hddSize,
        ecScheme: r.ecScheme,
        cacheCount: r.cacheConfig.count,
        cacheSizePerDisk: r.cacheConfig.sizePerDisk,
        networkType: r.network.type,
        networkSpeed: r.network.speedGb,
        ...patch,
      },
    }))
    if (newCapacityTiB !== undefined) setCapacityValue(convertTibToUnit(newCapacityTiB, capacityUnit))
  }

  // 增加节点数时改用得盘率最高的允许方案（更高得盘率的方案可能刚解锁）；
  // 减少节点数时保留当前方案，仅在其不再允许时回退到得盘率最高的方案
  const handleGpfsHybridNodeCountChange = (newCount: number) => {
    if (!results['gpfs-hybrid'] || newCount < GPFS_HYBRID_CONSTANTS.MIN_NODES || newCount > GPFS_HYBRID_CONSTANTS.MAX_NODES) return
    const { hddPerNode, hddSize, ecScheme, nodeCount } = results['gpfs-hybrid']
    const allowed = getGpfsHybridAllowedSchemes(newCount)
    const scheme = newCount > nodeCount
      ? getGpfsHybridBestEc(newCount)
      : (allowed.find(s => s.scheme === ecScheme) ?? getGpfsHybridBestEc(newCount))
    patchGpfsHybrid(
      { nodeCount: newCount, ecScheme: scheme.scheme },
      gpfsHybridCapacity(newCount, hddPerNode, hddSize, scheme.efficiency)
    )
  }

  const handleGpfsHybridHddPerNodeChange = (newHddPerNode: number) => {
    if (!results['gpfs-hybrid']) return
    const { nodeCount, hddSize, efficiency } = results['gpfs-hybrid']
    // HDD 数量变化后 NVMe 层容量下限随之变化，重新自动选型
    const cache = gpfsHybridCacheConfig(newHddPerNode, hddSize)
    patchGpfsHybrid(
      { hddPerNode: newHddPerNode, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk },
      gpfsHybridCapacity(nodeCount, newHddPerNode, hddSize, efficiency)
    )
  }

  const handleGpfsHybridHddSizeChange = (newHddSize: number) => {
    if (!results['gpfs-hybrid']) return
    const { nodeCount, hddPerNode, efficiency } = results['gpfs-hybrid']
    const cache = gpfsHybridCacheConfig(hddPerNode, newHddSize)
    patchGpfsHybrid(
      { hddSize: newHddSize, cacheCount: cache.count, cacheSizePerDisk: cache.sizePerDisk },
      gpfsHybridCapacity(nodeCount, hddPerNode, newHddSize, efficiency)
    )
  }

  const handleGpfsHybridEcChange = (scheme: string) => {
    if (!results['gpfs-hybrid']) return
    const { nodeCount, hddPerNode, hddSize } = results['gpfs-hybrid']
    const s = getGpfsHybridAllowedSchemes(nodeCount).find(x => x.scheme === scheme)
    if (!s) return
    patchGpfsHybrid({ ecScheme: scheme }, gpfsHybridCapacity(nodeCount, hddPerNode, hddSize, s.efficiency))
  }

  const handleGpfsHybridCacheCountChange = (newCount: number) => {
    if (!results['gpfs-hybrid']) return
    patchGpfsHybrid({ cacheCount: newCount })
  }

  const handleGpfsHybridCacheSizeChange = (newSize: number) => {
    if (!results['gpfs-hybrid']) return
    patchGpfsHybrid({ cacheSizePerDisk: newSize })
  }

  const handleGpfsHybridNetworkTypeChange = (newType: string) => {
    patchGpfsHybrid({ networkType: newType })
  }

  // 切到 25Gb 时 IB 无对应规格，自动回退到该速率的首个可选类型（RoCE）
  const handleGpfsHybridNetworkSpeedChange = (newSpeed: number) => {
    const r = results['gpfs-hybrid']
    if (!r) return
    const allowed = getGpfsHybridAllowedNetworkTypes(newSpeed)
    const type = allowed.find(n => n.value === r.network.type)?.value ?? allowed[0].value
    patchGpfsHybrid({ networkSpeed: newSpeed, networkType: type })
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
  const selectClass = "field-lg min-w-[5.5rem] shrink-0"
  const inputClass = "field-lg flex-1"

  const clearSelection = () => {
    setSelectedStorages(new Set())
    setManualConfig({})
  }

  // 结果区滚动锚点：AI 助手应用参数后把用户带到结果上
  const focusResults = () => {
    document.getElementById('plan-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /**
   * 把 AI 助手解析出的参数写进规划表单。手动微调过的配置一并清掉，
   * 否则会用旧的服务器台数覆盖掉新需求算出的规模。
   */
  const applyPlan = (plan: PlanDirective) => {
    setManualConfig({})
    setCapacityUnit(plan.capacity.unit)
    setCapacityValue(String(plan.capacity.value))
    if (plan.bandwidthUnit) setBwUnit(plan.bandwidthUnit)
    setDownloadBWValue(plan.readBandwidth ? String(plan.readBandwidth) : '')
    setUploadBWValue(plan.writeBandwidth ? String(plan.writeBandwidth) : '')
    setSelectedStorages(new Set(plan.storages))
    // 等结果区渲染出来再滚动
    requestAnimationFrame(focusResults)
  }

  // 表单当前状态的指纹，用来判断某张方案卡里的参数是否还是眼下这一组
  const currentSignature = planSignature({
    storages: [...selectedStorages],
    capacity: { value: Number(capacityValue), unit: capacityUnit },
    readBandwidth: downloadBWValue ? Number(downloadBWValue) : undefined,
    writeBandwidth: uploadBWValue ? Number(uploadBWValue) : undefined,
    bandwidthUnit: bwUnit,
  })
  const isPlanApplied = (plan: PlanDirective) => planSignature(plan) === currentSignature

  /** 方案卡上的按钮：参数已被改动就先还原成这张卡记下的那一组，再滚到结果 */
  const restorePlan = (plan: PlanDirective) => {
    if (isPlanApplied(plan)) focusResults()
    else applyPlan(plan)
  }

  // 结果区内容：每个方案的规划结果，由 SchemePanel 提供卡壳与卡头
  const renderResult = (key: (typeof STORAGE_ORDER)[number]) => {
    switch (key) {
      case 'vastdata':
        return results.vastdata && (
          <VastDataResult data={results.vastdata} onEboxCountChange={handleVastDataEboxCountChange} onDiskChange={handleVastDataDiskChange} />
        )
      case 'gpfs-ece':
        return results['gpfs-ece'] && (
          <GPFSECEResult data={results['gpfs-ece']} onServerCountChange={handleGpfsServerCountChange} onDiskChange={handleGpfsDiskChange} onEcChange={handleGpfsEcChange} onSsdCountChange={handleGpfsSsdCountChange} />
        )
      case 'gpfs-hybrid':
        return results['gpfs-hybrid'] && (
          <GPFSHybridResult data={results['gpfs-hybrid']} onNodeCountChange={handleGpfsHybridNodeCountChange} onHddPerNodeChange={handleGpfsHybridHddPerNodeChange} onHddSizeChange={handleGpfsHybridHddSizeChange} onEcChange={handleGpfsHybridEcChange} onCacheCountChange={handleGpfsHybridCacheCountChange} onCacheSizeChange={handleGpfsHybridCacheSizeChange} onNetworkTypeChange={handleGpfsHybridNetworkTypeChange} onNetworkSpeedChange={handleGpfsHybridNetworkSpeedChange} />
        )
      case 'weka':
        return results.weka && (
          <WekaResult data={results.weka} onDataNodeCountChange={handleWekaDataNodeCountChange} onHotSpareChange={handleWekaHotSpareChange} onDiskChange={handleWekaDiskChange} onNvmeCountChange={handleWekaNvmeCountChange} onProtectionChange={handleWekaProtectionChange} onNetworkChange={handleWekaNetworkChange} />
        )
      case 'xeos':
        return results.xeos && (
          <XEOSResult data={results.xeos} onServerCountChange={handleXeosServerCountChange} onDiskChange={handleXeosDiskChange} onDisksPerServerChange={handleXeosDisksPerServerChange} onEcChange={handleXeosEcChange} onCacheCountChange={handleXeosCacheCountChange} onCacheSizeChange={handleXeosCacheSizeChange} />
        )
      case 'ceph':
        return results.ceph && (
          <CephResult data={results.ceph} onNodeCountChange={handleCephNodeCountChange} onMdsNodeCountChange={handleCephMdsNodeCountChange} onDisksPerNodeChange={handleCephDisksPerNodeChange} onDiskChange={handleCephDiskChange} onRedundancyChange={handleCephRedundancyChange} />
        )
      case 'ceph-hybrid':
        return results['ceph-hybrid'] && (
          <CephHybridResult data={results['ceph-hybrid']} onNodeCountChange={handleCephHybridNodeCountChange} onDisksPerNodeChange={handleCephHybridDisksPerNodeChange} onDiskChange={handleCephHybridDiskChange} onRedundancyChange={handleCephHybridRedundancyChange} onCacheCountChange={handleCephHybridCacheCountChange} onCacheSizeChange={handleCephHybridCacheSizeChange} />
        )
    }
  }

  return (
    <div className="min-h-screen bg-canvas-soft">
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-tight text-ink">Storplan</h1>
              <p className="truncate text-xs text-mute">{t('存储容量与性能规划', 'Storage capacity & performance planning')}</p>
            </div>
          </div>
          <nav className="-mr-1 flex shrink-0 items-center gap-0.5">
            <a
              href="https://wutz.dev/"
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-body transition hover:bg-canvas-soft-2 hover:text-ink"
            >
              wutz.dev ↗
            </a>
            <PrefsSwitcher />
          </nav>
        </div>
      </header>

      {/* @container：下面的分栏按内容区宽度而不是窗口宽度来算，AI 侧边栏展开挤窄页面时自动减少列数 */}
      <div className="@container mx-auto max-w-7xl px-4 sm:px-8">

        <section className={hasSelection ? 'pt-8 pb-6' : 'pt-12 pb-8 sm:pt-16'}>
          <h2 className={`max-w-3xl text-balance font-semibold tracking-tight text-ink ${hasSelection ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>{t('从容量与带宽需求，直达可采购的集群配置', 'From capacity and bandwidth requirements to a purchasable cluster configuration')}</h2>
          {!hasSelection && (
            <>
              <p className="mt-3 max-w-2xl text-pretty text-base leading-relaxed text-body">
                {t('填入容量和带宽，一次对比 VastData、GPFS/Scale、Weka、XSKY XEOS 与 Ceph 的集群规模、硬件清单和性能指标。', 'Enter capacity and bandwidth to compare cluster size, bill of materials and performance for VastData, GPFS/Scale, Weka, XSKY XEOS and Ceph side by side.')}
              </p>
              <button type="button" onClick={openAiAssistant} className="btn-secondary mt-6">
                <SparkleIcon className="h-4 w-4 text-brand" />
                {t('让 AI 帮我选', 'Let AI help me choose')}
              </button>
            </>
          )}
        </section>

        <div id="plan-params" className="card mb-8 scroll-mt-24 p-6 sm:p-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink"><span className="step-num">1</span>{t('选择存储方案', 'Choose storage solutions')}<span className="font-normal text-mute">{t('（可多选，并排对比）', ' (select several to compare side by side)')}</span></span>
            {hasSelection && (
              <span className="flex items-center gap-2 text-xs text-mute">
                {t(`已选 ${selectedStorages.size} 个`, `${selectedStorages.size} selected`)}
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded-md px-1.5 py-0.5 text-xs text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {t('清空', 'Clear')}
                </button>
              </span>
            )}
          </div>
          <div className="mb-6 grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {STORAGE_ORDER.map((key) => {
              const th = THEME[key]
              const active = selectedStorages.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleStorage(key)}
                  aria-pressed={active}
                  className={`group flex items-start gap-3 rounded-lg border p-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${active ? 'border-ink bg-canvas' : 'border-hairline bg-canvas hover:border-hairline-strong hover:bg-canvas-soft'}`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${active ? '' : 'border-hairline-strong bg-canvas group-hover:border-ink/40'}`}
                    style={active ? { backgroundColor: th.color, borderColor: th.color } : undefined}
                  >
                    {active && <CheckIcon className="h-3 w-3 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium leading-tight text-ink`}>{th.label[lang]}</span>
                    <span className="mt-1 block text-xs text-mute">{th.category[lang]}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="mb-3 flex items-center gap-2 border-t border-hairline pt-6 text-sm font-medium text-ink"><span className="step-num">2</span>{t('填写容量与带宽', 'Enter capacity and bandwidth')}</div>
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @3xl:grid-cols-4">
            <div>
              <label htmlFor="capacity" className="mb-1.5 block text-sm font-medium text-ink">{t('容量', 'Capacity')}</label>
              <div className="flex gap-2">
                <input
                  id="capacity"
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
                  aria-label={t('容量单位', 'Capacity unit')}
                >
                  <option value="TiB">TiB</option>
                  <option value="PiB">PiB</option>
                  <option value="TB">TB</option>
                  <option value="PB">PB</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="read-bw" className="mb-1.5 block text-sm font-medium text-ink">{bwLabels.read}</label>
              <input
                id="read-bw"
                type="number"
                value={downloadBWValue}
                onChange={(e) => { setDownloadBWValue(e.target.value); setManualConfig({}) }}
                placeholder="20"
                className="field-lg w-full"
                min="0"
                step="0.1"
              />
            </div>
            <div>
              <label htmlFor="write-bw" className="mb-1.5 block text-sm font-medium text-ink">{bwLabels.write}</label>
              <input
                id="write-bw"
                type="number"
                value={uploadBWValue}
                onChange={(e) => { setUploadBWValue(e.target.value); setManualConfig({}) }}
                placeholder="10"
                className="field-lg w-full"
                min="0"
                step="0.1"
              />
            </div>
            <div>
              <label htmlFor="bw-unit" className="mb-1.5 block text-sm font-medium text-ink">{t('带宽单位', 'Bandwidth unit')}</label>
              <select
                id="bw-unit"
                value={bwUnit}
                onChange={(e) => { setBwUnit(e.target.value); setManualConfig({}) }}
                className="field-lg w-full"
              >
                <option value="MB/s">MB/s</option>
                <option value="GB/s">GB/s</option>
                <option value="Mbps">Mbps</option>
                <option value="Gbps">Gbps</option>
              </select>
            </div>
          </div>
          <p className="mt-3 text-xs text-mute">{t('带宽可留空，此时只按容量规划；填写后，集群规模取容量与带宽两者中要求更高的一项。', 'Bandwidth is optional; if left blank, sizing is based on capacity only. Otherwise the cluster is sized by whichever of capacity or bandwidth demands more.')}</p>
        </div>

        {!hasSelection && <SelectionGuide onSelect={toggleStorage} />}

                <div id="plan-results" className="grid grid-cols-1 items-start gap-8 @5xl:grid-cols-2">
          {STORAGE_ORDER.filter(key => selectedStorages.has(key)).map(key => (
            <SchemePanel
              key={key}
              storage={key}
              badge={key === 'xeos' && results.xeos?.ultraLarge ? t('超大规模 · 两级架构', 'Ultra-large · two-tier architecture') : undefined}
              error={errors[key]}
            >
              {renderResult(key)}
            </SchemePanel>
          ))}
        </div>

        <footer className="mt-12 space-y-1 pb-8 text-center text-xs text-mute">
          <div>
            <a href="https://github.com/wutz/storplan" target="_blank" rel="noopener noreferrer" className="transition hover:text-ink">
              GitHub: wutz/storplan
            </a>
          </div>
          <div className="font-mono">{t('构建时间：', 'Built: ')}{__BUILD_TIME__}{t('（Asia/Shanghai）', ' (Asia/Shanghai)')}</div>
        </footer>
      </div>

      <AiAssistant onApplyPlan={applyPlan} onRestorePlan={restorePlan} isPlanApplied={isPlanApplied} />
    </div>
  )
}


// 选型参考里的方案名：可点击的品牌色 chip（无对应方案 key 时退化为纯文本）
function GuideName({ row, onSelect }: { row: GuideRow; onSelect: (key: string) => void }) {
  const th = row.key ? THEME[row.key] : undefined
  if (!row.key || !th) return <span className="font-medium text-ink">{row.name}</span>
  return (
    <button
      type="button"
      onClick={() => onSelect(row.key!)}
      className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-canvas px-2.5 py-1 text-xs font-medium text-ink transition hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <BrandDot color={th.color} className="h-1.5 w-1.5" />
      {row.name}
    </button>
  )
}

function SelectionGuide({ onSelect }: { onSelect: (key: string) => void }) {
  const { lang, t } = usePrefs()
  const { SELECTION_GUIDE } = localizeCatalog(lang)
  return (
    <div className="card p-6 sm:p-8">
      <div className="mb-6">
        <h3 className="text-lg font-semibold tracking-tight text-ink">{t('拿不准选哪个？先看看各方案的取舍', 'Not sure which to pick? Compare the trade-offs first')}</h3>
        <p className="mt-1 text-pretty text-sm text-body">{t('按文件、对象、块三类整理了各方案的优缺点和适用场景；点击方案名即可直接开始规划。', 'Pros, cons and typical use cases of each solution, grouped by file, object and block. Click a solution name to start planning.')}</p>
      </div>
      <div className="space-y-8">
        {SELECTION_GUIDE.map((section) => (
          <div key={section.title}>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">{section.title}</h4>
            {/* 宽屏：四列对比表 */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-xs text-mute border-b border-hairline">
                    <th className="py-2 pr-4 font-medium whitespace-nowrap">{t('方案', 'Solution')}</th>
                    <th className="py-2 pr-4 font-medium">{t('优点', 'Pros')}</th>
                    <th className="py-2 pr-4 font-medium">{t('缺点', 'Cons')}</th>
                    <th className="py-2 font-medium">{t('适用场景', 'Use cases')}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.name} className="border-b border-hairline align-top">
                      <td className="py-2.5 pr-4 whitespace-nowrap">
                        <GuideName row={row} onSelect={onSelect} />
                      </td>
                      <td className="py-2.5 pr-4 leading-relaxed text-body">{row.pros}</td>
                      <td className="py-2.5 pr-4 leading-relaxed text-body">{row.cons}</td>
                      <td className="py-2.5 leading-relaxed text-body">{row.scenarios}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 窄屏：堆叠卡片，避免四列中文表格被挤成竖条 */}
            <ul className="space-y-3 sm:hidden">
              {section.rows.map((row) => (
                <li key={row.name} className="rounded-lg border border-hairline bg-canvas-soft p-3.5">
                  <GuideName row={row} onSelect={onSelect} />
                  <dl className="mt-3 space-y-2 text-sm">
                    <div>
                      <dt className="eyebrow">{t('优点', 'Pros')}</dt>
                      <dd className="mt-0.5 leading-relaxed text-body">{row.pros}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow">{t('缺点', 'Cons')}</dt>
                      <dd className="mt-0.5 leading-relaxed text-body">{row.cons}</dd>
                    </div>
                    <div>
                      <dt className="eyebrow">{t('适用场景', 'Use cases')}</dt>
                      <dd className="mt-0.5 leading-relaxed text-body">{row.scenarios}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
            {section.notes && section.notes.map((n, i) => (
              <p key={i} className="mt-2 text-xs text-mute">{t('注：', 'Note: ')}{n}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}


/**
 * 单个方案的外壳：品牌色顶条 + 卡头（名称 / 类别 / 徽标）+ 可折叠的优劣与限制 + 规划结果。
 * 一个方案一张卡，避免说明与结果各占一张卡、顶条重复。
 */
function SchemePanel({ storage, badge, error, children }: {
  storage: StorageKey;
  badge?: string;
  error?: string;
  children?: React.ReactNode;
}) {
  const { lang, t } = usePrefs()
  const th = THEME[storage]
  const info = localizeCatalog(lang).STORAGE_INFO[storage]
  const [notesOpen, setNotesOpen] = useState(false)
  // 说明区展开时它自带下边框，卡体需要补回上内边距
  const bodyPad = notesOpen ? 'px-6 pt-6 pb-6' : 'px-6 pb-6'

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <BrandDot color={th.color} className="h-2.5 w-2.5" />
            <h2 className="text-xl font-semibold tracking-tight text-ink">{th.title[lang]}</h2>
            {badge && <span className="rounded-full bg-canvas-soft-2 px-2 py-0.5 text-xs text-body">{badge}</span>}
          </div>
          <p className="mt-1 text-xs text-mute">{th.category[lang]}</p>
        </div>
        {info && (
          <button
            type="button"
            onClick={() => setNotesOpen(v => !v)}
            aria-expanded={notesOpen}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-hairline bg-canvas px-2.5 text-[13px] text-body transition hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {t('优势、劣势与限制', 'Strengths, weaknesses & limits')}
            <ChevronIcon className={`h-3 w-3 transition-transform ${notesOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
        {info && <p className="w-full text-pretty text-sm leading-relaxed text-body">{info.description}</p>}
      </div>

      {info && notesOpen && <SchemeNotes info={info} />}

      {(error || children) && (
        <div className={`space-y-4 ${bodyPad}`}>
          {error && (
            <div className="error-box">
              <p>{error}</p>
            </div>
          )}
          {children}
        </div>
      )}
    </section>
  )
}

// 优势 / 劣势 / 限制：卡内浅底内嵌区（DESIGN.md card-soft）
function SchemeNotes({ info }: { info: ReturnType<typeof localizeCatalog>['STORAGE_INFO'][StorageKey] }) {
  const { t } = usePrefs()
  return (
    <div className="border-y border-hairline bg-canvas-soft px-6 py-5">
      <div className="grid grid-cols-1 gap-5 text-sm md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-link-deep">{t('优势', 'Strengths')}</h3>
          <ul className="dot-list">
            {info.pros.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-warning-deep">{t('劣势', 'Weaknesses')}</h3>
          <ul className="dot-list">
            {info.cons.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
        {info.limits && (
          <div className="md:col-span-2">
            <h3 className="mb-2 text-xs font-semibold text-error-deep">{t('限制', 'Limits')}</h3>
            <ul className="dot-list">
              {info.limits.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
      </div>
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
  const { t } = usePrefs()
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

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{ul ? t('二级总服务器台数', 'Total tier-2 servers') : t('服务器台数', 'Servers')}</dt>
              <Stepper label={ul ? t('二级总服务器台数', 'total tier-2 servers') : t('服务器台数', 'servers')} value={data.serverCount} unit={t('台', 'nodes')} onChange={onServerCountChange} min={3} />
            </div>
            <div>
              <dt className="text-body">{ul ? t('二级集群 HDD 总数', 'Total tier-2 HDDs') : t('集群 HDD 总数', 'Total HDDs in cluster')}</dt>
              <dd className={totalDisks > hddLimit ? 'text-error-deep font-semibold' : ''}>
                {totalDisks.toLocaleString()} / {hddLimit.toLocaleString()}{t(' 块', ' disks')}
                {totalDisks > hddLimit && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    <WarnIcon className="h-3 w-3" />
                    {t('超出上限', 'Over limit')}
                  </span>
                )}
              </dd>
            </div>
            {ul && (
              <div>
                <dt className="text-body">{t('二级数据集群', 'Tier-2 data clusters')}</dt>
                <dd>{ul.lastClusterNodes === ul.nodesPerCluster
                  ? t(`${ul.tier2ClusterCount} 个 × ${ul.nodesPerCluster} 节点`, `${ul.tier2ClusterCount} × ${ul.nodesPerCluster} nodes`)
                  : t(`${ul.tier2ClusterCount} 个（前 ${ul.tier2ClusterCount - 1} 个各 ${ul.nodesPerCluster} 节点，末簇 ${ul.lastClusterNodes} 节点）`, `${ul.tier2ClusterCount} (first ${ul.tier2ClusterCount - 1} with ${ul.nodesPerCluster} nodes each, last with ${ul.lastClusterNodes} nodes)`)}</dd>
              </div>
            )}
            {ul ? (
              <div>
                <dt className="text-body">{t('纠删码方案', 'Erasure coding')}</dt>
                <dd>EC8+2{t('（每集群 2 池）', ' (2 pools per cluster)')}</dd>
              </div>
            ) : (
              <div>
                <dt className="text-body">{t('纠删码方案', 'Erasure coding')}</dt>
                <dd>
                  <select value={data.ecScheme} onChange={(e) => { const s = XEOS_EC_SCHEMES.find(s => s.scheme === e.target.value); if (s) onEcChange(s.efficiency) }} aria-label={t('纠删码方案', 'Erasure coding scheme')} className="field">
                    {getAllowedEcSchemes(data.serverCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                  </select>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
              <dd>{ul
                ? (lastClusterIsFull
                    ? t(`每集群容忍 ${ul.tier2PerClusterTolerance} 台节点离线`, `Each cluster tolerates ${ul.tier2PerClusterTolerance} node failure${ul.tier2PerClusterTolerance === 1 ? '' : 's'}`)
                    : t(`满簇容忍 ${ul.tier2PerClusterTolerance} 台（末簇 ${ul.lastClusterNodes} 节点容忍 ${lastClusterTolerance} 台）`, `Full clusters tolerate ${ul.tier2PerClusterTolerance} node failure${ul.tier2PerClusterTolerance === 1 ? '' : 's'} (last cluster of ${ul.lastClusterNodes} nodes tolerates ${lastClusterTolerance})`))
                : t(`容忍 ${data.tolerance} 台节点离线`, `Tolerates ${data.tolerance} node failure${data.tolerance === 1 ? '' : 's'}`)}</dd>
            </div>
            {data.poolConfig && (
              <div>
                <dt className="text-body">{t('池数', 'Pools')}</dt>
                <dd>{t(`${data.poolConfig.poolCount} 个池`, `${data.poolConfig.poolCount} pools`)}</dd>
              </div>
            )}
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
              <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
            </div>
            <div>
              <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
            {ul && (
              <>
                <div>
                  <dt className="text-body">{t('单集群可用容量', 'Usable capacity per cluster')}</dt>
                  <dd>{formatCapacity(ul.tier2PerClusterCapacity, data.capacityUnitPreference)}</dd>
                </div>
                <div>
                  <dt className="text-body">{t('二级 SSD 总容量', 'Total tier-2 SSD capacity')}</dt>
                  <dd>{ul.tier2CacheSSDTotal.toLocaleString()} TB</dd>
                </div>
              </>
            )}
          </dl>
        </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{ul ? t('每台二级数据节点配置（混闪）', 'Per tier-2 data node (hybrid)') : t('每台服务器配置', 'Per-server configuration')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 4314</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>8 × 32GB DDR4{t('（共 256GB）', ' (256GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.disksPerServer} onChange={(e) => onDisksPerServerChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {XEOS_CONSTANTS.DISKS_PER_SERVER_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {XEOS_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>HDD</span>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('索引缓存盘', 'Index cache disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.cacheConfig.count} onChange={(e) => onCacheCountChange(Number(e.target.value))} aria-label={t('缓存盘数量', 'Cache disk count')} className="field">
                  {[1, 2, 3, 4].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.cacheConfig.sizePerDisk} onChange={(e) => onCacheSizeChange(Number(e.target.value))} aria-label={t('单块缓存盘容量', 'Capacity per cache disk')} className="field">
                  {XEOS_CONSTANTS.CACHE_DISK_SIZES.map(s => <option key={s} value={s}>{s}TB</option>)}
                </select>
                <span className="text-xs">NVMe SSD{t('（DWPD ≥ 3）', ' (DWPD ≥ 3)')}</span>
                {!isCacheSufficient && (
                  <span className="inline-flex items-center gap-1 text-xs text-error-deep">
                    <WarnIcon className="h-3 w-3" />
                    {t('不足', 'Insufficient')}
                  </span>
                )}
              </dd>
            </div>
            <div className="text-xs text-mute">
              <dt>{t('缓存容量要求', 'Required cache capacity')}</dt>
              <dd>≥ {requiredCacheTB.toFixed(2)}TB{t('（实际 ', ' (actual ')}{data.cacheConfig.totalSize.toFixed(2)}TB{t('）', ')')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('网卡', 'NICs')}</dt>
              <dd>{t('2 × 双口 25Gb 以太网卡', '2 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
          </dl>
        </div>
        {ul && mc && (
          <div className="pt-4">
            <h3 className="eyebrow mb-3">{t('一级元数据集群（全闪 NVMe）', 'Tier-1 metadata cluster (all-flash NVMe)')}</h3>
            <dl className="spec-list text-sm">
              <div><dt className="text-body">{t('节点数', 'Nodes')}</dt><dd>{t(`${mc.nodeCount} 台（${mc.ecScheme}，范围 6–20）`, `${mc.nodeCount} (${mc.ecScheme}, range 6–20)`)}</dd></div>
              <div><dt className="text-body">{t('处理器', 'CPU')}</dt><dd>2 × Intel 6330</dd></div>
              <div><dt className="text-body">{t('内存', 'Memory')}</dt><dd>256GB</dd></div>
              <div><dt className="text-body">{t('系统盘', 'System disks')}</dt><dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd></div>
              <div><dt className="text-body">{t('数据盘', 'Data disks')}</dt><dd>{mc.disksPerNode} × {mc.diskSize}TB NVMe SSD{t('（DWPD ≥ 3）', ' (DWPD ≥ 3)')}</dd></div>
              <div><dt className="text-body">{t('NVMe 总容量', 'Total NVMe capacity')}</dt><dd>{mc.totalSize.toLocaleString()} TB</dd></div>
              <div><dt className="text-body">{t('网卡', 'NICs')}</dt><dd>{t('2 × 双口 25Gb 以太网卡', '2 × dual-port 25Gb Ethernet NIC')}</dd></div>
              <div><dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt><dd>{t(`容忍 ${mc.tolerance} 台节点离线`, `Tolerates ${mc.tolerance} node failure${mc.tolerance === 1 ? '' : 's'}`)}</dd></div>
              <div className="text-xs text-mute"><dt>{t('容量配比', 'Capacity ratio')}</dt><dd>{t('二级 SSD 总容量 / 一级 NVMe 总容量', 'Tier-2 SSD total / tier-1 NVMe total')} = {ul.ratio.toFixed(2)}{t('（目标 5）', ' (target 5)')}</dd></div>
            </dl>
          </div>
        )}
        <div>
          <h3 className="eyebrow mb-3">{ul ? t('性能（厂商标称，按二级 HDD 计）', 'Performance (vendor rated, tier-2 HDDs)') : t('性能（厂商标称）', 'Performance (vendor rated)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('下载带宽', 'Download bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.downloadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('上传带宽', 'Upload bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.uploadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 下载带宽', 'Download bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('下载 OPS', 'Download OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.downloadOps}</dd>
            </div>
            <div>
              <dt className="text-body">{t('上传 OPS', 'Upload OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.uploadOps}</dd>
            </div>
          </dl>
        </div>
    </div>
  )
}

function VastDataResult({ data, onEboxCountChange, onDiskChange }: { data: VastDataPlanResult; onEboxCountChange: (n: number) => void; onDiskChange: (n: number) => void }) {
  const { t } = usePrefs()
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('EBox 数量', 'EBoxes')}</dt>
              <Stepper label={t('EBox 数量', 'EBoxes')} value={data.eboxCount} unit={t('台', 'nodes')} onChange={onEboxCountChange} min={11} max={250} />
            </div>
            <div>
              <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
              <dd>{t('容忍 2 台节点离线', 'Tolerates 2 node failures')}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
              <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
            </div>
            <div>
              <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
          </dl>
        </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台 EBox 配置', 'Per-EBox configuration')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>AMD 9454P 2.75GHz 290W</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>12 × 32GB DDR5-5600 RDIMM{t('（共 384GB）', ' (384GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB M.2 SATA SSD</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('数据盘配置', 'Data disk configuration')} className="field">
                  {VAST_CONSTANTS.EBOX_CONFIGS.map(c => <option key={c.diskSize} value={c.diskSize}>{c.label}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('网络', 'Network')}</dt>
              <dd>{t('2 × 双口 200Gb RoCE/IB/ETH 网卡', '2 × dual-port 200Gb RoCE/IB/ETH NIC')}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能（厂商标称）', 'Performance (vendor rated)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('持续写带宽', 'Sustained write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('峰值写带宽', 'Burst write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.burstWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 IOPS', 'Read IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 IOPS', 'Write IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
    </div>
  )
}

function GPFSECEResult({ data, onServerCountChange, onDiskChange, onEcChange, onSsdCountChange }: { data: GPFSECEPlanResult; onServerCountChange: (n: number) => void; onDiskChange: (n: number) => void; onEcChange: (n: number) => void; onSsdCountChange: (n: number) => void }) {
  const { t } = usePrefs()
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('服务器台数', 'Servers')}</dt>
              <Stepper label={t('服务器台数', 'servers')} value={data.serverCount} unit={t('台', 'nodes')} onChange={onServerCountChange} min={3} max={GPFS_CONSTANTS.MAX_SERVERS} />
            </div>
            <div>
              <dt className="text-body">{t('纠删码方案', 'Erasure coding')}</dt>
              <dd>
                <select value={data.ecScheme} onChange={(e) => { const s = GPFS_EC_SCHEMES.find(s => s.scheme === e.target.value); if (s) onEcChange(s.efficiency) }} aria-label={t('纠删码方案', 'Erasure coding scheme')} className="field">
                  {getAllowedECSchemes(data.serverCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                </select>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
              <dd>{t(`容忍 ${data.tolerance} 台节点离线`, `Tolerates ${data.tolerance} node failure${data.tolerance === 1 ? '' : 's'}`)}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
              <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
            </div>
            <div>
              <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
              <dd>{data.formatted.rawCapacity}</dd>
            </div>
          </dl>
        </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台服务器配置', 'Per-server configuration')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>16 × 32GB DDR5 4800{t('（共 512GB）', ' (512GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('存储网络', 'Storage network')}</dt>
              <dd>{t('2 × 双口 200Gb RoCE/IB 网卡', '2 × dual-port 200Gb RoCE/IB NIC')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('管理网络', 'Management network')}</dt>
              <dd>{t('1 × 双口 25Gb 以太网卡', '1 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd>
                <select value={data.ssdCount} onChange={(e) => onSsdCountChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {GPFS_CONSTANTS.SSD_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select> × <select value={data.ssdSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {GPFS_CONSTANTS.SSD_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select> NVMe SSD
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能估算', 'Estimated performance')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 IOPS', 'Read IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 IOPS', 'Write IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
    </div>
  )
}

function GPFSHybridResult({ data, onNodeCountChange, onHddPerNodeChange, onHddSizeChange, onEcChange, onCacheCountChange, onCacheSizeChange, onNetworkTypeChange, onNetworkSpeedChange }: {
  data: GPFSHybridPlanResult;
  onNodeCountChange: (n: number) => void;
  onHddPerNodeChange: (n: number) => void;
  onHddSizeChange: (n: number) => void;
  onEcChange: (s: string) => void;
  onCacheCountChange: (n: number) => void;
  onCacheSizeChange: (n: number) => void;
  onNetworkTypeChange: (s: string) => void;
  onNetworkSpeedChange: (n: number) => void;
}) {
  const { t } = usePrefs()
  const totalHDD = data.nodeCount * data.hddPerNode
  const cacheReq = gpfsHybridCacheRequirement(data.hddPerNode, data.hddSize)
  const isCacheSufficient = data.cacheConfig.totalSize >= cacheReq.minTB
  const isCacheRecommended = data.cacheConfig.totalSize >= cacheReq.recommendedTB
  const cacheCountOptions = Array.from(
    { length: GPFS_HYBRID_CONSTANTS.MAX_CACHE_DISKS - GPFS_HYBRID_CONSTANTS.MIN_CACHE_DISKS + 1 },
    (_, i) => GPFS_HYBRID_CONSTANTS.MIN_CACHE_DISKS + i
  )
  const perTiB = (mibps: number) => (mibps / data.actualCapacity * MIB_TO_MB).toFixed(2) + ' MB/s'
  // 仅当规模与单机配置都与报告基准一致时才是实测值，否则均为线性外推
  const isBaselineScale = data.nodeCount === GPFS_HYBRID_BASELINE.nodeCount
    && data.hddPerNode === GPFS_HYBRID_BASELINE.hddPerNode
    && data.hddSize === GPFS_HYBRID_BASELINE.hddSizeTB
    && data.cacheConfig.count === GPFS_HYBRID_BASELINE.cacheDisksPerNode
    && data.cacheConfig.sizePerDisk === GPFS_HYBRID_BASELINE.cacheSizeTB
    && data.network.type === GPFS_HYBRID_BASELINE.networkType
    && data.network.speedGb === GPFS_HYBRID_BASELINE.networkSpeed

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('服务器台数', 'Servers')}</dt>
                <Stepper label={t('服务器台数', 'servers')} value={data.nodeCount} unit={t('台', 'nodes')} onChange={onNodeCountChange} min={GPFS_HYBRID_CONSTANTS.MIN_NODES} max={GPFS_HYBRID_CONSTANTS.MAX_NODES} />
              </div>
              <div>
                <dt className="text-body">{t('纠删码方案', 'Erasure coding')}</dt>
                <dd>
                  <select value={data.ecScheme} onChange={(e) => onEcChange(e.target.value)} aria-label={t('纠删码方案', 'Erasure coding scheme')} className="field">
                    {getGpfsHybridAllowedSchemes(data.nodeCount).map(s => <option key={s.scheme} value={s.scheme}>{s.scheme}</option>)}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="text-body">{t('冗余得盘率', 'Redundancy efficiency')}</dt>
                <dd>{(data.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
                <dd>{t(`容忍 ${data.tolerance} 台节点离线`, `Tolerates ${data.tolerance} node failure${data.tolerance === 1 ? '' : 's'}`)}</dd>
              </div>
              <div>
                <dt className="text-body">{t('集群 HDD 总数', 'Total HDDs in cluster')}</dt>
                <dd>{totalHDD.toLocaleString()}{t(' 块', ' disks')}</dd>
              </div>
              <div>
                <dt className="text-body">{t('集群 NVMe 总容量', 'Total NVMe capacity in cluster')}</dt>
                <dd>{data.cacheTotalTB.toLocaleString()} TB</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-3">{t('容量（HDD 数据层）', 'Capacity (HDD data tier)')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
                <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
              </div>
              <div>
                <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
                <dd>{data.formatted.rawCapacity}</dd>
              </div>
              <div className="text-xs text-mute">
                <dt>{t('说明', 'Note')}</dt>
                <dd>{t('已预留 5% 系统开销；元数据放在 NVMe 层，不占用 HDD 容量', '5% reserved for system overhead; metadata lives on the NVMe tier and uses no HDD capacity')}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台服务器配置（混闪）', 'Per-server configuration (hybrid)')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 5520+ 2.2GHz 28C</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>16 × 32GB ECC-RDIMM{t('（共 512GB）', ' (512GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 480GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.hddPerNode} onChange={(e) => onHddPerNodeChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {GPFS_HYBRID_CONSTANTS.HDD_PER_NODE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.hddSize} onChange={(e) => onHddSizeChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {GPFS_HYBRID_CONSTANTS.HDD_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>SAS 7.2K HDD</span>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('元数据 / 热数据盘', 'Metadata / hot-data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.cacheConfig.count} onChange={(e) => onCacheCountChange(Number(e.target.value))} aria-label={t('NVMe 盘数量', 'NVMe disk count')} className="field">
                  {cacheCountOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.cacheConfig.sizePerDisk} onChange={(e) => onCacheSizeChange(Number(e.target.value))} aria-label={t('单块 NVMe 容量', 'Capacity per NVMe disk')} className="field">
                  {GPFS_HYBRID_CONSTANTS.CACHE_DISK_SIZES.map(s => <option key={s} value={s}>{s}TB</option>)}
                </select>
                <span className="text-xs">NVMe SSD</span>
                {!isCacheSufficient ? (
                  <span className="inline-flex items-center gap-1 text-xs text-error-deep">
                    <WarnIcon className="h-3 w-3" />
                    {t(`低于 ${(GPFS_HYBRID_CONSTANTS.CACHE_MIN_RATIO * 100).toFixed(0)}% 下限`, `Below ${(GPFS_HYBRID_CONSTANTS.CACHE_MIN_RATIO * 100).toFixed(0)}% minimum`)}
                  </span>
                ) : !isCacheRecommended && (
                  <span className="inline-flex items-center gap-1 text-xs text-warning-deep">
                    <WarnIcon className="h-3 w-3" />
                    {t('低于推荐', 'Below recommended')}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('存储网络', 'Storage network')}</dt>
              <dd className="flex items-center gap-1">
                <span>{t('2 × 双口', '2 × dual-port')}</span>
                <select value={data.network.speedGb} onChange={(e) => onNetworkSpeedChange(Number(e.target.value))} aria-label={t('存储网络速率', 'Storage network speed')} className="field">
                  {GPFS_HYBRID_CONSTANTS.NETWORK_SPEEDS.map(s => <option key={s} value={s}>{s}Gb</option>)}
                </select>
                <select value={data.network.type} onChange={(e) => onNetworkTypeChange(e.target.value)} aria-label={t('存储网络类型', 'Storage network type')} className="field">
                  {getGpfsHybridAllowedNetworkTypes(data.network.speedGb).map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
                <span>{t('网卡', 'NIC')}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PerfTier
            title={t(`SSD 层（开启分层${isBaselineScale ? '' : '，预测'}）`, `SSD tier (tiering on${isBaselineScale ? '' : ', projected'})`)}
            hint={t('热数据命中 NVMe 层，随集群 NVMe 总数外推', 'Hot data served from the NVMe tier; extrapolated by total NVMe count')}
            perf={data.formatted.tiered}
            perTiBRead={perTiB(data.performance.tiered.readBandwidth)}
            networkLimited={data.networkLimited.tiered}
          />
          <PerfTier
            title={t(`HDD 层（关闭分层${isBaselineScale ? '' : '，预测'}）`, `HDD tier (tiering off${isBaselineScale ? '' : ', projected'})`)}
            hint={t('IO 全部落在 HDD 层，随集群 HDD 总数外推', 'All IO hits the HDD tier; extrapolated by total HDD count')}
            perf={data.formatted.hddOnly}
            perTiBRead={perTiB(data.performance.hddOnly.readBandwidth)}
            networkLimited={data.networkLimited.hddOnly}
          />
        </div>
    </div>
  )
}

// 分层开启 / 关闭两组性能指标共用的小节
function PerfTier({ title, hint, perf, perTiBRead, networkLimited }: {
  title: string;
  hint: string;
  perf: { readBandwidth: string; writeBandwidth: string; readIOPS: string; writeIOPS: string };
  perTiBRead: string;
  networkLimited?: boolean;
}) {
  const { t } = usePrefs()
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="eyebrow">{t('性能', 'Performance')}</h3>
        <span className="rounded-full bg-canvas-soft-2 px-2 py-0.5 text-xs text-body">{title}</span>
        {networkLimited && (
          <span className="inline-flex items-center gap-1 text-xs text-warning-deep">
            <WarnIcon className="h-3 w-3" />
            {t('受存储网络限制', 'Limited by storage network')}
          </span>
        )}
      </div>
      <dl className="stat-grid grid grid-cols-2 gap-2">
        <div>
          <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
          <dd className="font-medium">{perf.readBandwidth}</dd>
        </div>
        <div>
          <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
          <dd className="font-medium">{perf.writeBandwidth}</dd>
        </div>
        <div>
          <dt className="text-body">{t('读 IOPS', 'Read IOPS')} (4KiB)</dt>
          <dd className="font-medium">{perf.readIOPS}</dd>
        </div>
        <div>
          <dt className="text-body">{t('写 IOPS', 'Write IOPS')} (4KiB)</dt>
          <dd className="font-medium">{perf.writeIOPS}</dd>
        </div>
        <div>
          <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
          <dd className="font-medium">{perTiBRead}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-mute">{hint}</p>
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
  const { t } = usePrefs()
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
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('数据节点数量', 'Data nodes')}</dt>
                <Stepper label={t('数据节点数量', 'data nodes')} value={data.nodeCount} unit={t('台', 'nodes')} onChange={onNodeCountChange} min={3} />
              </div>
              <div>
                <dt className="text-body">{t('元数据节点数量（仅 CephFS）', 'Metadata nodes (CephFS only)')}</dt>
                <Stepper label={t('元数据节点数量', 'metadata nodes')} value={data.mdsNodeCount} unit={t('台', 'nodes')} onChange={onMdsNodeCountChange} min={CEPH_CONSTANTS.MIN_MDS_NODES} />
              </div>
              <div>
                <dt className="text-body">{t('数据冗余策略', 'Data redundancy')}</dt>
                <dd className="flex items-center gap-1">
                  <select value={data.redundancy} onChange={(e) => onRedundancyChange(e.target.value)} aria-label={t('数据冗余策略', 'Data redundancy')} className="field">
                    {getCephAllowedSchemes(data.nodeCount).map(s => <option key={s.scheme} value={s.scheme}>{schemeLabel(s.scheme, t)}{s.notRecommended ? t('（不建议用于生产）', ' (not recommended for production)') : ''}</option>)}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="text-body">{t('冗余得盘率', 'Redundancy efficiency')}</dt>
                <dd>{(data.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
                <dd>{t(`容忍 ${data.tolerance} 台节点离线`, `Tolerates ${data.tolerance} node failure${data.tolerance === 1 ? '' : 's'}`)}</dd>
              </div>
              <div>
                <dt className="text-body">{t('集群磁盘总数', 'Total disks in cluster')}</dt>
                <dd>{totalDisks.toLocaleString()}{t(' 块', ' disks')}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
                <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
              </div>
              <div>
                <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
                <dd>{data.formatted.rawCapacity}</dd>
              </div>
              <div className="text-xs text-mute">
                <dt>{t('综合得盘率', 'Overall efficiency')}</dt>
                <dd>{(effectiveRate * 100).toFixed(1)}%{t('（已预留 1 个节点，并按 70% 均衡系数折算）', ' (1 node reserved, 70% balance factor applied)')}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台数据节点配置', 'Per data node configuration')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>{mem.dimmCount} × {mem.dimmSizeGB}GB DDR5 4800{t(`（共 ${mem.totalGB}GB）`, ` (${mem.totalGB}GB total)`)}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('存储网络', 'Storage network')}</dt>
              <dd>{storageNet.label}</dd>
            </div>
            <div>
              <dt className="text-body">{t('管理网络（选配）', 'Management network (optional)')}</dt>
              <dd>{t('1 × 双口 25Gb 以太网卡', '1 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.disksPerNode} onChange={(e) => onDisksPerNodeChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {CEPH_CONSTANTS.DISKS_PER_NODE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {CEPH_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>NVMe SSD{t('（TLC）', ' (TLC)')}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t(`每台元数据节点配置（仅 CephFS，共 ${data.mdsNodeCount} 台）`, `Per metadata node configuration (CephFS only, ${data.mdsNodeCount} nodes)`)}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 6530</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>{mdsMem.dimmCount} × {mdsMem.dimmSizeGB}GB DDR5 4800{t(`（共 ${mdsMem.totalGB}GB）`, ` (${mdsMem.totalGB}GB total)`)}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('存储网络', 'Storage network')}</dt>
              <dd>{mdsStorageNet.label}</dd>
            </div>
            <div>
              <dt className="text-body">{t('管理网络（选配）', 'Management network (optional)')}</dt>
              <dd>{t('1 × 双口 25Gb 以太网卡', '1 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd>{t('无', 'None')}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能估算（CephFS / RBD）', 'Estimated performance (CephFS / RBD)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 IOPS', 'Read IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 IOPS', 'Write IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能估算（RGW 对象存储）', 'Estimated performance (RGW object storage)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 OPS', 'Read OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 OPS', 'Write OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteOPS}</dd>
            </div>
          </dl>
        </div>
        <div className="text-xs text-mute space-y-0.5">
          <div>{t('容量计算：（节点数 − 1）× 冗余得盘率 × 单节点盘数 × 单盘容量 × 0.7（均衡系数）', 'Capacity: (nodes − 1) × redundancy efficiency × disks per node × disk size × 0.7 (balance factor)')}</div>
          <div>{t(`性能计算：集群盘总数 × 每盘平均性能（${schemeLabel(data.redundancy, t)}：读 ${perDisk.readMiBps} MiB/s、写 ${perDisk.writeMiBps} MiB/s、读 IOPS ${perDisk.readIOPS / 1000}k、写 IOPS ${perDisk.writeIOPS / 1000}k）`, `Performance: total disks × average per-disk performance (${schemeLabel(data.redundancy, t)}: read ${perDisk.readMiBps} MiB/s, write ${perDisk.writeMiBps} MiB/s, read IOPS ${perDisk.readIOPS / 1000}k, write IOPS ${perDisk.writeIOPS / 1000}k)`)}</div>
          <div>{t(`RGW 每盘平均性能：读 ${CEPH_RGW_PER_DISK.readMiBps} MiB/s、写 ${CEPH_RGW_PER_DISK.writeMiBps} MiB/s、读 OPS ${CEPH_RGW_PER_DISK.readOPS}、写 OPS ${CEPH_RGW_PER_DISK.writeOPS}`, `RGW average per-disk performance: read ${CEPH_RGW_PER_DISK.readMiBps} MiB/s, write ${CEPH_RGW_PER_DISK.writeMiBps} MiB/s, read OPS ${CEPH_RGW_PER_DISK.readOPS}, write OPS ${CEPH_RGW_PER_DISK.writeOPS}`)}</div>
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
  const { t } = usePrefs()
  const totalDisks = data.nodeCount * data.disksPerNode
  const effectiveRate = data.actualCapacity / data.rawCapacity
  const requiredCacheTB = (data.disksPerNode * data.diskSize) / CEPH_HYBRID_CONSTANTS.CACHE_RATIO
  const isCacheSufficient = data.cacheConfig.totalSize >= requiredCacheTB
  const perTiBReadBW = data.rgwPerformance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('数据节点数量', 'Data nodes')}</dt>
                <Stepper label={t('数据节点数量', 'data nodes')} value={data.nodeCount} unit={t('台', 'nodes')} onChange={onNodeCountChange} min={3} />
              </div>
              <div>
                <dt className="text-body">{t('数据冗余策略', 'Data redundancy')}</dt>
                <dd className="flex items-center gap-1">
                  <select value={data.redundancy} onChange={(e) => onRedundancyChange(e.target.value)} aria-label={t('数据冗余策略', 'Data redundancy')} className="field">
                    {getCephHybridAllowedSchemes(data.nodeCount).map(s => <option key={s.scheme} value={s.scheme}>{schemeLabel(s.scheme, t)}{s.notRecommended ? t('（不建议用于生产）', ' (not recommended for production)') : ''}</option>)}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="text-body">{t('冗余得盘率', 'Redundancy efficiency')}</dt>
                <dd>{(data.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
                <dd>{t(`容忍 ${data.tolerance} 台节点离线`, `Tolerates ${data.tolerance} node failure${data.tolerance === 1 ? '' : 's'}`)}</dd>
              </div>
              <div>
                <dt className="text-body">{t('集群 HDD 总数', 'Total HDDs in cluster')}</dt>
                <dd>{totalDisks.toLocaleString()}{t(' 块', ' disks')}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
                <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
              </div>
              <div>
                <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
                <dd>{data.formatted.rawCapacity}</dd>
              </div>
              <div className="text-xs text-mute">
                <dt>{t('综合得盘率', 'Overall efficiency')}</dt>
                <dd>{(effectiveRate * 100).toFixed(1)}%{t('（已预留 1 个节点，并按 70% 均衡系数折算）', ' (1 node reserved, 70% balance factor applied)')}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台数据节点配置（混闪）', 'Per data node configuration (hybrid)')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 4314</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>8 × 32GB DDR4{t('（共 256GB）', ' (256GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.disksPerNode} onChange={(e) => onDisksPerNodeChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {CEPH_HYBRID_CONSTANTS.DISKS_PER_NODE_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <span>×</span>
                <select value={data.diskSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {CEPH_HYBRID_CONSTANTS.DISK_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>HDD</span>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('索引盘', 'Index disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.cacheConfig.count} onChange={(e) => onCacheCountChange(Number(e.target.value))} aria-label={t('缓存盘数量', 'Cache disk count')} className="field">
                  {[1, 2, 3, 4].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.cacheConfig.sizePerDisk} onChange={(e) => onCacheSizeChange(Number(e.target.value))} aria-label={t('单块缓存盘容量', 'Capacity per cache disk')} className="field">
                  {CEPH_HYBRID_CONSTANTS.CACHE_DISK_SIZES.map(s => <option key={s} value={s}>{s}TB</option>)}
                </select>
                <span className="text-xs">NVMe SSD</span>
                {!isCacheSufficient && (
                  <span className="inline-flex items-center gap-1 text-xs text-error-deep">
                    <WarnIcon className="h-3 w-3" />
                    {t('不足', 'Insufficient')}
                  </span>
                )}
              </dd>
            </div>
            <div className="text-xs text-mute">
              <dt>{t('索引盘容量要求', 'Required index disk capacity')}</dt>
              <dd>≥ {requiredCacheTB.toFixed(2)}TB{t('（实际 ', ' (actual ')}{data.cacheConfig.totalSize.toFixed(2)}TB{t('）', ')')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('网卡', 'NICs')}</dt>
              <dd>{t('2 × 双口 25Gb 以太网卡', '2 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能估算（RGW 对象存储）', 'Estimated performance (RGW object storage)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 OPS', 'Read OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwReadOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 OPS', 'Write OPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.rgwWriteOPS}</dd>
            </div>
          </dl>
        </div>
        <div className="text-xs text-mute space-y-0.5">
          <div>{t('容量计算：（节点数 − 1）× 冗余得盘率 × 单节点盘数 × 单盘容量 × 0.7（均衡系数）', 'Capacity: (nodes − 1) × redundancy efficiency × disks per node × disk size × 0.7 (balance factor)')}</div>
          <div>{t(`RGW 每 HDD 平均性能：读 ${RGW_HYBRID_PER_DISK.readMiBps} MiB/s、写 ${RGW_HYBRID_PER_DISK.writeMiBps} MiB/s、读 OPS ${RGW_HYBRID_PER_DISK.readOPS}、写 OPS ${RGW_HYBRID_PER_DISK.writeOPS}`, `RGW average per-HDD performance: read ${RGW_HYBRID_PER_DISK.readMiBps} MiB/s, write ${RGW_HYBRID_PER_DISK.writeMiBps} MiB/s, read OPS ${RGW_HYBRID_PER_DISK.readOPS}, write OPS ${RGW_HYBRID_PER_DISK.writeOPS}`)}</div>
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
  const { t } = usePrefs()
  const perTiBReadBW = data.performance.readBandwidth / data.actualCapacity
  const perTiBReadBWFormatted = (perTiBReadBW * MIB_TO_MB).toFixed(2) + ' MB/s'
  const minDataNodes = WEKA_CONSTANTS.MIN_TOTAL_NODES - WEKA_CONSTANTS.HOT_SPARE

  return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="eyebrow mb-3">{t('集群配置', 'Cluster configuration')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('总台数', 'Total nodes')}</dt>
                <dd>{data.nodeCount}{t(' 台', ' nodes')}</dd>
              </div>
              <div>
                <dt className="text-body">{t('数据节点数量', 'Data nodes')}</dt>
                <Stepper label={t('数据节点数量', 'data nodes')} value={data.dataNodeCount} unit={t('台', 'nodes')} onChange={onDataNodeCountChange} min={minDataNodes} />
              </div>
              <div>
                <dt className="text-body">{t('热备节点数量', 'Hot spare nodes')}</dt>
                <Stepper label={t('热备节点数量', 'hot spare nodes')} value={data.hotSpareCount} unit={t('台', 'nodes')} onChange={onHotSpareChange} min={0} />
              </div>
              <div>
                <dt className="text-body">{t('保护级别', 'Protection level')} (P)</dt>
                <dd>
                  <select value={data.protectionLevel} onChange={(e) => onProtectionChange(Number(e.target.value))} aria-label={t('保护级别', 'Protection level')} className="field">
                    {WEKA_CONSTANTS.PROTECTION_LEVELS.map(p => <option key={p} value={p}>+{p}</option>)}
                  </select>
                </dd>
              </div>
              <div>
                <dt className="text-body">{t('纠删码方案', 'Erasure coding')}</dt>
                <dd>{data.protection.scheme}</dd>
              </div>
              <div>
                <dt className="text-body">{t('得盘率', 'Storage efficiency')}</dt>
                <dd>{(data.protection.efficiency * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt className="text-body">{t('容错能力', 'Fault tolerance')}</dt>
                <dd>{t(`容忍 ${data.protection.P} 台节点离线`, `Tolerates ${data.protection.P} node failure${data.protection.P === 1 ? '' : 's'}`)}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-3">{t('容量', 'Capacity')}</h3>
            <dl className="spec-list text-sm">
              <div>
                <dt className="text-body">{t('可用容量', 'Usable capacity')}</dt>
                <dd className="text-xl font-semibold tracking-tight text-ink">{data.formatted.capacity}</dd>
              </div>
              <div>
                <dt className="text-body">{t('裸容量', 'Raw capacity')}</dt>
                <dd>{data.formatted.rawCapacity}</dd>
              </div>
              <div className="text-xs text-mute">
                <dt>{t('说明', 'Note')}</dt>
                <dd>{t('已预留 10% 给元数据与系统；热备节点不计入容量', '10% reserved for metadata and system; hot spares are excluded from capacity')}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('每台服务器配置', 'Per-server configuration')}</h3>
          <dl className="spec-list text-sm">
            <div>
              <dt className="text-body">{t('处理器', 'CPU')}</dt>
              <dd>2 × Intel Xeon 5418Y</dd>
            </div>
            <div>
              <dt className="text-body">{t('内存', 'Memory')}</dt>
              <dd>12 × 32GB DDR5{t('（共 384GB）', ' (384GB total)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('系统盘', 'System disks')}</dt>
              <dd>2 × 960GB SATA SSD{t('（RAID1）', ' (RAID1)')}</dd>
            </div>
            <div>
              <dt className="text-body">{t('数据盘', 'Data disks')}</dt>
              <dd className="flex items-center gap-1">
                <select value={data.nvmePerNode} onChange={(e) => onNvmeCountChange(Number(e.target.value))} aria-label={t('每台数据盘数量', 'Data disks per server')} className="field">
                  {WEKA_CONSTANTS.NVME_COUNTS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <span>×</span>
                <select value={data.ssdSize} onChange={(e) => onDiskChange(Number(e.target.value))} aria-label={t('单盘容量', 'Capacity per disk')} className="field">
                  {WEKA_CONSTANTS.SSD_SIZES.map(d => <option key={d} value={d}>{d}TB</option>)}
                </select>
                <span>NVMe SSD</span>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('存储网络', 'Storage network')}</dt>
              <dd>
                <select value={data.networkType} onChange={(e) => onNetworkChange(e.target.value)} aria-label={t('存储网络', 'Storage network')} className="field">
                  <option value="100gb">{t('2 × 双口 100Gb IB/RoCE/ETH 网卡', '2 × dual-port 100Gb IB/RoCE/ETH NIC')}</option>
                  <option value="200gb">{t('2 × 双口 200Gb IB/RoCE/ETH 网卡', '2 × dual-port 200Gb IB/RoCE/ETH NIC')}</option>
                </select>
              </dd>
            </div>
            <div>
              <dt className="text-body">{t('管理网络', 'Management network')}</dt>
              <dd>{t('1 × 双口 25Gb 以太网卡', '1 × dual-port 25Gb Ethernet NIC')}</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="eyebrow mb-3">{t('性能估算（含热备节点）', 'Estimated performance (incl. hot spares)')}</h3>
          <dl className="stat-grid grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-body">{t('读带宽', 'Read bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.readBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写带宽', 'Write bandwidth')} (4MiB)</dt>
              <dd className="font-medium">{data.formatted.writeBandwidth}</dd>
            </div>
            <div>
              <dt className="text-body">{t('每 TiB 读带宽', 'Read bandwidth per TiB')} (4MiB)</dt>
              <dd className="font-medium">{perTiBReadBWFormatted}</dd>
            </div>
            <div>
              <dt className="text-body">{t('读 IOPS', 'Read IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.readIOPS}</dd>
            </div>
            <div>
              <dt className="text-body">{t('写 IOPS', 'Write IOPS')} (4KiB)</dt>
              <dd className="font-medium">{data.formatted.writeIOPS}</dd>
            </div>
          </dl>
        </div>
    </div>
  )
}
