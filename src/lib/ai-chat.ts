/**
 * AI 规划助手的前后端共用契约：
 * 会话消息类型、规划指令（模型输出的结构化参数）、以及从回复正文里剥离规划块的解析器。
 *
 * 模型在回复末尾附一段 <storplan-plan>{...}</storplan-plan>，前端解析后写入页面顶部的规划参数，
 * 由既有的容量 / 性能计算逻辑出结果 —— 模型只负责“听懂需求、选方案、定参数”，不负责算数。
 */

import { STORAGE_ORDER } from './storage-catalog'
import type { StorageKey } from './storage-catalog'

export const PLAN_OPEN_TAG = '<storplan-plan>'
export const PLAN_CLOSE_TAG = '</storplan-plan>'

export const CAPACITY_UNITS = ['TiB', 'PiB', 'TB', 'PB'] as const
export const BANDWIDTH_UNITS = ['MB/s', 'GB/s', 'Mbps', 'Gbps'] as const

export type CapacityUnit = (typeof CAPACITY_UNITS)[number]
export type BandwidthUnit = (typeof BANDWIDTH_UNITS)[number]

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 模型给出的规划参数，对应页面顶部「规划参数」表单的各个字段 */
export interface PlanDirective {
  /** 要对比的方案（1–3 个），对应 STORAGE_ORDER 中的 key */
  storages: StorageKey[]
  capacity: { value: number; unit: CapacityUnit }
  /** 读带宽（对象存储语义下为下载带宽），留空表示仅按容量规划 */
  readBandwidth?: number
  /** 写带宽（对象存储语义下为上传带宽） */
  writeBandwidth?: number
  bandwidthUnit?: BandwidthUnit
  /** 一句话说明取值依据，展示在“已应用”卡片里 */
  note?: string
}

/** 请求体上限：既防滥用，也避免上游 token 超限 */
export const CHAT_LIMITS = {
  maxMessages: 24,
  maxCharsPerMessage: 2000,
  maxTotalChars: 20000,
} as const

const MAX_CAPACITY_VALUE = 1_000_000
const MAX_BANDWIDTH_VALUE = 100_000

function toFiniteNumber(input: unknown): number | undefined {
  const n = typeof input === 'string' ? Number(input) : input
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined
  return n
}

/**
 * 校验并归一化模型输出的规划指令。任一必填项不合法就返回 undefined —— 宁可不应用，
 * 也不要把越界数值塞进表单让计算逻辑抛异常。
 */
export function normalizePlan(raw: unknown): PlanDirective | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>

  const storages = Array.isArray(obj.storages)
    ? (obj.storages.filter(
        (k): k is StorageKey => typeof k === 'string' && (STORAGE_ORDER as readonly string[]).includes(k),
      ).slice(0, 4))
    : []
  if (storages.length === 0) return undefined

  const capacityRaw = obj.capacity as Record<string, unknown> | undefined
  const capacityValue = toFiniteNumber(capacityRaw?.value)
  const capacityUnit = capacityRaw?.unit
  if (
    capacityValue === undefined ||
    capacityValue <= 0 ||
    capacityValue > MAX_CAPACITY_VALUE ||
    typeof capacityUnit !== 'string' ||
    !(CAPACITY_UNITS as readonly string[]).includes(capacityUnit)
  ) {
    return undefined
  }

  const bandwidthUnit =
    typeof obj.bandwidthUnit === 'string' && (BANDWIDTH_UNITS as readonly string[]).includes(obj.bandwidthUnit)
      ? (obj.bandwidthUnit as BandwidthUnit)
      : undefined

  const clampBandwidth = (input: unknown): number | undefined => {
    const n = toFiniteNumber(input)
    if (n === undefined || n <= 0 || n > MAX_BANDWIDTH_VALUE) return undefined
    return n
  }

  const note = typeof obj.note === 'string' ? obj.note.slice(0, 200) : undefined

  return {
    storages: [...new Set(storages)],
    capacity: { value: capacityValue, unit: capacityUnit as CapacityUnit },
    readBandwidth: clampBandwidth(obj.readBandwidth),
    writeBandwidth: clampBandwidth(obj.writeBandwidth),
    bandwidthUnit,
    note,
  }
}

/**
 * 把回复正文拆成「给人看的文字」和「规划指令」。
 *
 * 流式渲染时会对同一段不断增长的文本反复调用：只出现了开标签、JSON 还没写完时，
 * 也要先把这段半成品从展示文本里藏掉，否则用户会看到裸的 JSON 一个字一个字冒出来。
 */
export function splitPlanBlock(text: string): { text: string; plan?: PlanDirective } {
  const openIndex = text.indexOf(PLAN_OPEN_TAG)
  if (openIndex === -1) return { text }

  const body = text.slice(openIndex + PLAN_OPEN_TAG.length)
  const closeIndex = body.indexOf(PLAN_CLOSE_TAG)
  const visible = (text.slice(0, openIndex) + (closeIndex === -1 ? '' : body.slice(closeIndex + PLAN_CLOSE_TAG.length))).trim()

  if (closeIndex === -1) return { text: visible }

  try {
    return { text: visible, plan: normalizePlan(JSON.parse(body.slice(0, closeIndex).trim())) }
  } catch {
    return { text: visible }
  }
}
