/**
 * AI 规划助手的前后端共用契约：会话消息类型、模型输出的两种结构化块，
 * 以及把它们从回复正文里剥出来的解析器。
 *
 * 模型的回复分三部分：
 * - 给人看的正文；
 * - <storplan-ask>{...}</storplan-ask>：澄清需求时给出的候选答案，前端渲染成可点的选项；
 * - <storplan-plan>{...}</storplan-plan>：条件确认后的规划参数，前端写进页面顶部的表单。
 *
 * 表单里的参数交给本站既有的容量 / 性能计算逻辑去算：模型只负责确认需求、选方案、定参数，不负责算数。
 */

import { STORAGE_ORDER } from './storage-catalog'
import type { StorageKey } from './storage-catalog'

export const PLAN_OPEN_TAG = '<storplan-plan>'
export const PLAN_CLOSE_TAG = '</storplan-plan>'
export const ASK_OPEN_TAG = '<storplan-ask>'
export const ASK_CLOSE_TAG = '</storplan-ask>'

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
  /** 本次规划用到的假设，逐条展示，方便用户挑出不成立的那条纠正 */
  assumptions?: string[]
}

/** 解析后的助手回复：正文 + 可点的候选答案 + 规划参数 */
export interface AssistantReply {
  text: string
  plan?: PlanDirective
  quickReplies: string[]
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
  const assumptions = normalizeStringList(obj.assumptions, 6, 120)

  return {
    storages: [...new Set(storages)],
    capacity: { value: capacityValue, unit: capacityUnit as CapacityUnit },
    readBandwidth: clampBandwidth(obj.readBandwidth),
    writeBandwidth: clampBandwidth(obj.writeBandwidth),
    bandwidthUnit,
    note,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
  }
}

/** 规划参数的指纹：用于判断页面表单当前是否还是某条规划指令应用后的状态 */
export function planSignature(plan: {
  storages: readonly string[]
  capacity: { value: number; unit: string }
  readBandwidth?: number
  writeBandwidth?: number
  bandwidthUnit?: string
}): string {
  const storages = [...plan.storages].sort().join(',')
  const read = plan.readBandwidth ?? ''
  const write = plan.writeBandwidth ?? ''
  // 读写都没有时带宽单位不影响结果，不参与比较
  const unit = read === '' && write === '' ? '' : (plan.bandwidthUnit ?? '')
  return [storages, plan.capacity.value, plan.capacity.unit, read, write, unit].join('|')
}

/** 去空、去重、限长限量的字符串列表（候选答案与假设共用） */
function normalizeStringList(raw: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const value = item.trim().slice(0, maxChars)
    if (value !== '') seen.add(value)
    if (seen.size >= maxItems) break
  }
  return [...seen]
}

/** 候选答案块：{"options":[...]}，也容忍模型直接给一个数组 */
function parseQuickReplies(payload: string): string[] {
  try {
    const parsed: unknown = JSON.parse(payload.trim())
    const raw = Array.isArray(parsed) ? parsed : (parsed as { options?: unknown } | null)?.options
    return normalizeStringList(raw, 5, 40)
  } catch {
    return []
  }
}

const BLOCKS = [
  { kind: 'plan' as const, open: PLAN_OPEN_TAG, close: PLAN_CLOSE_TAG },
  { kind: 'ask' as const, open: ASK_OPEN_TAG, close: ASK_CLOSE_TAG },
]

/**
 * 把回复拆成「给人看的正文」、候选答案与规划指令。
 *
 * 流式渲染时会对同一段不断增长的文本反复调用，所以要处理三种半成品：
 * 已闭合的块（取出内容）、开标签已到但内容没写完（整段藏掉）、
 * 连开标签本身都只到一半（如 "<storplan-"，也要藏掉，否则会闪出裸标签）。
 */
export function parseAssistantReply(raw: string): AssistantReply {
  let text = raw
  const payloads: Record<'plan' | 'ask', string[]> = { plan: [], ask: [] }

  for (const block of BLOCKS) {
    for (;;) {
      const start = text.indexOf(block.open)
      if (start === -1) break
      const bodyStart = start + block.open.length
      const end = text.indexOf(block.close, bodyStart)
      if (end === -1) break // 未闭合，交给下面的裁剪
      payloads[block.kind].push(text.slice(bodyStart, end))
      text = text.slice(0, start) + text.slice(end + block.close.length)
    }
  }

  // 裁掉未闭合的块，以及结尾那半个开标签
  let cut = text.length
  for (const block of BLOCKS) {
    const start = text.indexOf(block.open)
    if (start !== -1) cut = Math.min(cut, start)
  }
  const lastLt = text.lastIndexOf('<', cut - 1)
  if (lastLt !== -1 && BLOCKS.some((b) => b.open.startsWith(text.slice(lastLt, cut)))) {
    cut = lastLt
  }

  const plan = payloads.plan.reduce<PlanDirective | undefined>((acc, payload) => {
    try {
      return normalizePlan(JSON.parse(payload.trim())) ?? acc
    } catch {
      return acc
    }
  }, undefined)

  return {
    text: text.slice(0, cut).trim(),
    plan,
    quickReplies: payloads.ask.flatMap(parseQuickReplies).slice(0, 5),
  }
}
