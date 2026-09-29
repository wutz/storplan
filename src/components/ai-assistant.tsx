/**
 * AI 规划助手：右下角的浮动按钮和多轮对话面板。
 * 大屏（≥1024px）以右侧边栏展开、页面向左让位；更小的屏幕从底部升起，页面向上让位，可展开到全屏。
 *
 * 模型只负责听懂需求、选方案、定参数；定好的参数通过 onApplyPlan 写回页面顶部的规划表单，
 * 具体数字仍由本站既有的容量 / 性能计算逻辑算出来。样式沿用 DESIGN.md（发丝线 + 堆叠阴影 + 墨黑主 CTA）。
 */

import { useEffect, useRef, useState } from 'react'
import { parseAssistantReply } from '#/lib/ai-chat'
import type { ChatMessage, PlanDirective } from '#/lib/ai-chat'
import { localizeCatalog } from '#/lib/storage-catalog'
import { tr, usePrefs } from '#/lib/i18n'

type Turn = {
  role: 'user' | 'assistant'
  /** 已剥离结构化块的展示文本 */
  text: string
  plan?: PlanDirective
  /** 模型给的候选答案，点一下即作为下一条消息发出 */
  quickReplies?: string[]
  searching?: boolean
}

/** 小于这个宽度按手机处理：打开时不自动聚焦输入框（免得键盘一弹就挡住欢迎语） */
const COMPACT_WIDTH = 640
/** 大屏以右侧边栏呈现：贴右、铺满高度，页面内容让出这块宽度而不是被盖住 */
const SIDEBAR_QUERY = '(min-width: 1024px)'
const SIDEBAR_WIDTH = 420
/** 小屏底部面板默认占视口高度的比例；上限留出顶部一截，让用户看得到页面还在 */
const SHEET_RATIO = 0.6
const SHEET_MIN_HEIGHT = 280
const SHEET_TOP_GAP = 48
/** 拖到离顶部不足这段距离时松手，直接吸附到全屏 */
const SHEET_SNAP_FULL = 24
const SHEET_HEIGHT_STORAGE_KEY = 'storplan.ai-sheet.height'
const CONVERSATIONS_STORAGE_KEY = 'storplan.ai-conversations'
/** 标签太多会挤不下，也没人真的并行聊这么多；超出时新建会顶掉最早的那个 */
const MAX_CONVERSATIONS = 8

/** 底部面板的位置：高度，以及离布局视口底边的距离（手机软键盘弹起时不为 0） */
type SheetFrame = { height: number; bottom: number }

/**
 * 以「视觉视口」为准而不是 window.innerHeight：
 * 手机弹出软键盘时布局视口不变、视觉视口会变矮，fixed 定位的 bottom: 0 会落到键盘后面。
 * 把视觉视口下沿到布局视口下沿的这段距离算出来当作 bottom，面板就能贴在键盘上方。
 */
function visibleHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

/** 半屏高度的合法区间：不低于最小高度，不高于「顶部留一截」 */
function clampSheetHeight(height: number): number {
  const vh = visibleHeight()
  return Math.round(Math.min(Math.max(height, Math.min(SHEET_MIN_HEIGHT, vh)), vh - SHEET_TOP_GAP))
}

/** preferred：用户拖出来的高度；没拖过就按视口比例给默认值 */
function sheetFrame(expanded: boolean, preferred: number | null): SheetFrame {
  const vv = window.visualViewport
  const vh = visibleHeight()
  const bottom = Math.max(0, window.innerHeight - (vv ? vv.offsetTop + vv.height : window.innerHeight))
  if (expanded) return { height: vh, bottom }
  return { height: clampSheetHeight(preferred ?? vh * SHEET_RATIO), bottom }
}

function readStoredSheetHeight(): number | null {
  try {
    const value = Number(localStorage.getItem(SHEET_HEIGHT_STORAGE_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

type Conversation = {
  id: string
  turns: Turn[]
  error: string | null
  busy: boolean
}

function newConversation(): Conversation {
  return { id: Math.random().toString(36).slice(2, 10), turns: [], error: null, busy: false }
}

/** 标签名取第一句提问，没问过就叫「新对话」 */
function conversationTitle(c: Conversation): string {
  const first = c.turns.find((t) => t.role === 'user')?.text.trim()
  return first ? first.replace(/\s+/g, ' ') : tr('新对话', 'New chat')
}

/** 从 localStorage 恢复对话；进行中的请求不会跨刷新存活，所以只留已完成的内容 */
function readStoredConversations(): { list: Conversation[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { list?: Conversation[]; activeId?: string }
    const list = (parsed.list ?? [])
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.turns))
      .map((c) => ({ ...c, busy: false, error: null, turns: c.turns.filter((t) => t.text.trim() !== '') }))
    if (list.length === 0) return null
    const activeId = list.some((c) => c.id === parsed.activeId) ? parsed.activeId! : list[0].id
    return { list, activeId }
  } catch {
    return null
  }
}

function isCompact(): boolean {
  return (window.visualViewport?.width ?? window.innerWidth) < COMPACT_WIDTH
}

const SUGGESTIONS = {
  zh: [
    '128 卡 H100 训练集群，训练数据 500TB，该选哪种存储？',
    '3PB 医学影像归档，主要走 S3 协议，该怎么规划？',
    '在 K8s 上搭 AI 平台，PVC 和对象存储各要配多大？',
  ],
  en: [
    '128× H100 training cluster with 500TB of training data — which storage should I pick?',
    '3PB medical imaging archive, mostly over S3 — how should I plan it?',
    'Building an AI platform on K8s — how big should PVC and object storage be?',
  ],
}

const WELCOME = {
  zh: '说说数据量、访问协议、GPU 规模或预算，我来挑方案、把参数填进规划表单。不想细答就说「按经验来」。',
  en: 'Tell me your data size, access protocols, GPU scale or budget — I\'ll pick a solution and fill in the planning form. Say "use your judgment" to skip the details.',
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M8 1.8l1.3 3.5L12.8 6.6 9.3 7.9 8 11.4 6.7 7.9 3.2 6.6 6.7 5.3 8 1.8Z" fill="currentColor" />
      <path d="M12.8 10.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5Z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true" className={className}>
      <path d="M7 11.5V2.5m0 0L3.2 6.3M7 2.5l3.8 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 极简 Markdown 渲染：只认加粗、无序列表与段落 —— 够表达结论 + 短列表，不引入依赖 */
function RichText({ text }: { text: string }) {
  const blocks = text.split('\n').filter((line) => line.trim() !== '')
  return (
    <>
      {blocks.map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line)
        const content = bullet ? line.replace(/^\s*[-*•]\s+/, '') : line
        const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={j} className="font-medium text-ink">{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part.replace(/^#+\s*/, '')}</span>
          ),
        )
        return bullet ? (
          <p key={i} className="mt-1 flex gap-2 pl-1">
            <span className="text-mute" aria-hidden>•</span>
            <span>{parts}</span>
          </p>
        ) : (
          <p key={i} className={i === 0 ? '' : 'mt-2'}>{parts}</p>
        )
      })}
    </>
  )
}

/**
 * 「已应用」卡片：把模型定出的参数摊开给用户看，避免表单被悄悄改掉。
 * 每张卡都记着自己那一组选项 —— 后面参数被改过（手动调、或又出了新方案）时，
 * 按钮变成「恢复这组参数」，点一下把表单还原成生成这张卡时的样子再看结果。
 */
function AppliedPlan({ plan, applied, onRestore }: {
  plan: PlanDirective
  applied: boolean
  onRestore: (plan: PlanDirective) => void
}) {
  const { lang, t } = usePrefs()
  const { STORAGE_NAMES } = localizeCatalog(lang)
  const bwUnit = plan.bandwidthUnit ?? 'GB/s'
  const rows: string[] = [`${t('容量', 'Capacity')} ${plan.capacity.value} ${plan.capacity.unit}`]
  if (plan.readBandwidth) rows.push(`${t('读', 'Read')} ${plan.readBandwidth} ${bwUnit}`)
  if (plan.writeBandwidth) rows.push(`${t('写', 'Write')} ${plan.writeBandwidth} ${bwUnit}`)

  return (
    <div className="mt-3 rounded-lg border border-hairline bg-canvas p-3">
      <p className="eyebrow">{t('已填入规划参数', 'Applied to planning form')}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">
        {plan.storages.map((k) => STORAGE_NAMES[k]).join(t('、', ', '))}
      </p>
      <p className="mt-1 font-mono text-xs text-body">{rows.join(' · ')}</p>
      {plan.note && <p className="mt-1.5 text-xs leading-relaxed text-mute">{plan.note}</p>}
      {plan.assumptions && plan.assumptions.length > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2">
          {/* 假设单独列出：用户一眼能挑出不成立的那条，直接回一句就能重算 */}
          <p className="eyebrow">{t('所用假设（如有不符请告诉我）', 'Assumptions (tell me if any are wrong)')}</p>
          <ul className="dot-list mt-1 text-xs">
            {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRestore(plan)}
        className="mt-2.5 inline-flex h-8 items-center rounded-md bg-ink px-3 text-[13px] font-medium text-on-ink transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {applied ? t('查看规划结果', 'View results') : t('恢复这组参数', 'Restore these parameters')}
      </button>
      {!applied && <p className="mt-1.5 text-xs text-mute">{t('表单已被改动，点击上方按钮可恢复为这组参数。', 'The form has changed since; click above to restore these parameters.')}</p>}
    </div>
  )
}

const OPEN_EVENT = 'storplan:open-ai-assistant'

/** 从页面其他位置（如首页 hero 按钮）打开助手面板 */
export function openAiAssistant() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

export function AiAssistant({ onApplyPlan, onRestorePlan, isPlanApplied }: {
  onApplyPlan: (plan: PlanDirective) => void
  /** 点「恢复这组参数并查看」：把表单还原成该方案并滚到结果区 */
  onRestorePlan: (plan: PlanDirective) => void
  /** 表单当前是否仍是该方案应用后的状态 */
  isPlanApplied: (plan: PlanDirective) => boolean
}) {
  const { lang, t } = usePrefs()
  const [open, setOpen] = useState(false)
  // 首帧用固定 id 渲染，挂载后再从 localStorage 恢复，避免 SSR 与客户端渲染不一致
  const [conversations, setConversations] = useState<Conversation[]>(() => [{ ...newConversation(), id: 'initial' }])
  const [activeId, setActiveId] = useState('initial')
  const [restored, setRestored] = useState(false)
  /** 每个对话各自的输入草稿：切标签不丢已经打了一半的字 */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sidebar, setSidebar] = useState(false)
  /** 小屏底部面板是否展开到全屏 */
  const [expanded, setExpanded] = useState(false)
  /** 用户拖出来的半屏高度；null 表示按视口比例取默认值 */
  const [preferredHeight, setPreferredHeight] = useState<number | null>(null)
  const [sheet, setSheet] = useState<SheetFrame | null>(null)
  /** 正在拖动抓手：拖动时关掉高度过渡，面板才能紧跟手指 */
  const [dragging, setDragging] = useState(false)

  const active = conversations.find((c) => c.id === activeId) ?? conversations[0]
  const { turns, busy, error } = active
  const input = drafts[active.id] ?? ''
  const setInput = (value: string) => setDrafts((d) => ({ ...d, [active.id]: value }))

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** 每个对话一个请求控制器：切标签时后台对话照常流式生成，关标签时才掐断 */
  const abortRef = useRef<Map<string, AbortController>>(new Map())
  const tabsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  /** 面板隐藏期间不自动滚到底，这样再打开时停在离开前的位置 */
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_EVENT, onOpen)
  }, [])

  useEffect(() => {
    const stored = readStoredConversations()
    if (stored) {
      setConversations(stored.list)
      setActiveId(stored.activeId)
    }
    setPreferredHeight(readStoredSheetHeight())
    setRestored(true)
  }, [])

  // 刷新页面后对话还在；恢复完成前不写，免得把空白初始状态盖到存档上
  useEffect(() => {
    if (!restored) return
    try {
      const list = conversations.map(({ id, turns }) => ({ id, turns }))
      localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify({ list, activeId }))
    } catch {
      // 隐私模式或配额满时写不了，忽略即可
    }
  }, [conversations, activeId, restored])

  useEffect(() => {
    if (!restored || preferredHeight === null) return
    try {
      localStorage.setItem(SHEET_HEIGHT_STORAGE_KEY, String(preferredHeight))
    } catch {
      // 同上
    }
  }, [preferredHeight, restored])

  // 新建或切换标签后把当前标签滚进可视区
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  useEffect(() => {
    const mq = window.matchMedia(SIDEBAR_QUERY)
    const sync = () => setSidebar(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  // 面板展开时通过 CSS 变量让页面让出空间（styles.css 里给 body 加 padding）：
  // 大屏让出右侧同宽，小屏让出底部同高，页面内容始终能滚到面板外面看全
  const sheetHeight = open && !sidebar && !expanded && sheet ? sheet.height : 0
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--ai-sidebar-width', open && sidebar ? `${SIDEBAR_WIDTH}px` : '0px')
    root.style.setProperty('--ai-sheet-height', `${sheetHeight}px`)
    return () => {
      root.style.removeProperty('--ai-sidebar-width')
      root.style.removeProperty('--ai-sheet-height')
    }
  }, [open, sidebar, sheetHeight])

  // 底部面板跟着视口重算 —— 手机软键盘弹起走的是 visualViewport 的 resize/scroll，window resize 不一定触发
  useEffect(() => {
    const update = () => setSheet(sheetFrame(expanded, preferredHeight))
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [expanded, preferredHeight])

  // 收起后下次打开回到半屏，别让用户一打开就被全屏面板吞掉页面
  useEffect(() => {
    if (!open) setExpanded(false)
  }, [open])

  useEffect(() => {
    // 手机上不自动聚焦：一打开就顶起键盘，反而看不见欢迎语和示例
    if (open && !isCompact()) inputRef.current?.focus()
  }, [open])

  // 底部面板展开到全屏时锁住背后页面，避免滑动对话内容时把整页也带着滚
  useEffect(() => {
    if (!open || sidebar || !expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open, sidebar, expanded])

  useEffect(() => {
    if (!openRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy, activeId])

  // 面板与页面并排（大屏在右、小屏在下），用户要边聊边改表单，所以点页面不自动收起，只认 Esc 和关闭按钮
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 关闭面板或卸载时掐断进行中的请求，避免流在后台继续跑
  useEffect(() => {
    const controllers = abortRef.current
    return () => controllers.forEach((c) => c.abort())
  }, [])

  /** 只改指定 id 的那个对话：流式回调可能在用户切到别的标签之后才到 */
  const updateConversation = (id: string, patch: (c: Conversation) => Conversation) =>
    setConversations((list) => list.map((c) => (c.id === id ? patch(c) : c)))

  const send = async (raw: string) => {
    const question = raw.trim()
    if (!question || busy) return
    const id = active.id

    // 历史里的助手消息已剥掉规划指令，模型不必再看自己上一轮的 JSON
    const history: ChatMessage[] = [...turns, { role: 'user' as const, text: question }]
      .filter((t) => t.text.trim() !== '')
      .map((t) => ({ role: t.role, content: t.text }))

    updateConversation(id, (c) => ({
      ...c,
      turns: [...c.turns, { role: 'user', text: question }, { role: 'assistant', text: '' }],
      error: null,
      busy: true,
    }))
    setDrafts((d) => ({ ...d, [id]: '' }))

    const controller = new AbortController()
    abortRef.current.set(id, controller)

    /** 只更新该对话末尾那条助手消息 */
    const patchLast = (patch: (turn: Turn) => Turn) =>
      updateConversation(id, (c) => ({ ...c, turns: c.turns.map((t, i) => (i === c.turns.length - 1 ? patch(t) : t)) }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, lang }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // 边缘 WAF 限流返回的是 Cloudflare 自己的 HTML 拦截页，解析不出我们的 JSON，
        // 所以按状态码兜一条明确的提示
        const detail = await res.json().catch(() => null)
        const fallback = res.status === 429 ? t('请求过于频繁，请稍后再试。', 'Too many requests, please try again later.') : t('请求失败，请稍后重试。', 'Request failed, please try again later.')
        throw new Error((detail as { error?: string } | null)?.error ?? fallback)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''
      let answer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          let event: { type: string; text?: string; message?: string }
          try {
            event = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          if (event.type === 'delta' && event.text) {
            answer += event.text
            const { text } = parseAssistantReply(answer)
            patchLast((t) => ({ ...t, text, searching: false }))
          } else if (event.type === 'search') {
            patchLast((t) => ({ ...t, searching: true }))
          } else if (event.type === 'error') {
            throw new Error(event.message ?? t('生成失败，请重试。', 'Generation failed, please retry.'))
          }
        }
      }

      const { text, plan, quickReplies } = parseAssistantReply(answer)
      patchLast((turn) => ({
        ...turn,
        text: text || t('（没有收到回复，请重试。）', '(No reply received, please retry.)'),
        plan,
        quickReplies,
        searching: false,
      }))
      if (plan) onApplyPlan(plan)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      // 丢掉空的助手占位，用户可以直接重问
      updateConversation(id, (c) => {
        const last = c.turns[c.turns.length - 1]
        return {
          ...c,
          error: err instanceof Error ? err.message : t('请求失败，请稍后重试。', 'Request failed, please try again later.'),
          turns: last?.role === 'assistant' && !last.text ? c.turns.slice(0, -1) : c.turns,
        }
      })
    } finally {
      // 被关掉的对话已不在列表里，这里的更新自然落空
      updateConversation(id, (c) => ({ ...c, busy: false }))
      if (abortRef.current.get(id) === controller) abortRef.current.delete(id)
    }
  }

  /** 新建对话：当前已经是空白对话就直接复用，不重复开空标签 */
  const createConversation = () => {
    if (active.turns.length === 0 && !active.busy) {
      inputRef.current?.focus()
      return
    }
    const fresh = newConversation()
    setConversations((list) => {
      const next = [...list, fresh]
      // 超出上限时丢掉最早且空闲的对话
      if (next.length <= MAX_CONVERSATIONS) return next
      const dropIndex = next.findIndex((c) => !c.busy)
      return dropIndex === -1 ? next : next.filter((_, i) => i !== dropIndex)
    })
    setActiveId(fresh.id)
    if (!isCompact()) requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** 关闭标签：掐断它的请求，并切到相邻的标签；关掉最后一个时留一个空白对话 */
  const closeConversation = (id: string) => {
    abortRef.current.get(id)?.abort()
    abortRef.current.delete(id)
    setDrafts(({ [id]: _, ...rest }) => rest)
    const index = conversations.findIndex((c) => c.id === id)
    const remaining = conversations.filter((c) => c.id !== id)
    if (remaining.length === 0) {
      const fresh = newConversation()
      setConversations([fresh])
      setActiveId(fresh.id)
      return
    }
    setConversations(remaining)
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id)
  }

  /**
   * 拖动顶部抓手调整底部面板高度。面板贴底，所以新高度 = 起始高度 − 手指上下位移。
   * 拖到接近顶部松手就吸附成全屏；在全屏状态下往下拖则回到半屏并跟手。
   */
  const startSheetResize = (e: React.PointerEvent) => {
    if (sidebar || e.button !== 0 || !sheet) return
    e.preventDefault()
    const startY = e.clientY
    const startHeight = sheet.height
    let moved = false
    let latest = startHeight
    setDragging(true)

    const onMove = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dy) < 4) return
      moved = true
      const vh = visibleHeight()
      latest = Math.min(Math.max(startHeight - dy, Math.min(SHEET_MIN_HEIGHT, vh)), vh)
      setExpanded(false)
      setSheet((f) => (f ? { ...f, height: latest } : f))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointercancel', onUp)
      setDragging(false)
      // 没拖动就当作一次点击：在半屏 / 全屏之间切换
      if (!moved) {
        setExpanded((v) => !v)
        return
      }
      if (latest >= visibleHeight() - SHEET_SNAP_FULL) {
        setExpanded(true)
        return
      }
      setPreferredHeight(clampSheetHeight(latest))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('pointercancel', onUp, { once: true })
  }

  /** 键盘也能调高度：焦点在抓手上时按 ↑ / ↓ */
  const onSheetHandleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const step = e.key === 'ArrowUp' ? 40 : -40
    setExpanded(false)
    setPreferredHeight(clampSheetHeight((sheet?.height ?? visibleHeight() * SHEET_RATIO) + step))
  }

  const showWelcome = turns.length === 0

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        className="ai-fade fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-on-ink hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        style={{
          boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 8px 16px -4px rgba(0,0,0,0.12)',
          opacity: open ? 0 : 1,
          transform: open ? 'scale(0.86)' : 'scale(1)',
          visibility: open ? 'hidden' : 'visible',
          /* 展开时按钮立刻让位（窗口正是从它长出来的）；收起时等面板缩回来了再浮现 */
          transition: open
            ? 'opacity 120ms ease-out, transform 120ms ease-out, visibility 0s linear 120ms'
            : 'opacity 160ms ease-out 170ms, transform 200ms cubic-bezier(0.32, 0.72, 0, 1) 150ms, visibility 0s',
        }}
      >
        <SparkIcon className="h-4 w-4" />
        {t('AI 规划助手', 'AI assistant')}
      </button>

      {/*
        面板始终挂载，只切换可见性：卸载会丢掉消息区的滚动位置，
        而收起再打开要停在离开前的地方。visibility 的切换延后到淡出结束，
        这样退出动画能完整播完。
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('AI 规划助手', 'AI planning assistant')}
        aria-hidden={!open}
        inert={!open}
        className={`ai-panel fixed z-40 flex flex-col overflow-hidden bg-canvas ${
          sidebar ? 'border-l border-hairline' : expanded ? '' : 'rounded-t-2xl border-t border-hairline'
        }`}
        style={sidebar ? {
          /* 侧边栏：贴右、铺满高度，从右侧滑入；页面同时让出宽度（见 --ai-sidebar-width） */
          top: 0,
          right: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH,
          boxShadow: open ? '-8px 0 24px -12px rgba(0,0,0,0.12)' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          visibility: open ? 'visible' : 'hidden',
          transition: open
            ? 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1), visibility 0s'
            : 'transform 220ms cubic-bezier(0.4, 0, 1, 1), visibility 0s linear 220ms',
        } : {
          /* 底部面板：贴底、横向铺满，从底部升起；半屏时页面同时让出底部高度（见 --ai-sheet-height） */
          left: 0,
          right: 0,
          bottom: sheet?.bottom ?? 0,
          height: sheet?.height ?? 0,
          boxShadow: open ? '0 -8px 24px -12px rgba(0,0,0,0.14)' : 'none',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          visibility: sheet && open ? 'visible' : 'hidden',
          /* 拖动抓手时去掉高度过渡，面板才会紧跟手指而不是慢半拍追上来 */
          transition: open
            ? `transform 300ms cubic-bezier(0.32, 0.72, 0, 1), ${dragging ? 'height 0s' : 'height 240ms cubic-bezier(0.32, 0.72, 0, 1)'}, visibility 0s`
            : 'transform 220ms cubic-bezier(0.4, 0, 1, 1), visibility 0s linear 220ms',
        }}
      >
        {/* 底部面板顶上的抓手：上下拖动调整高度，点一下在半屏 / 全屏之间切换 */}
        {!sidebar && (
          <button
            type="button"
            onPointerDown={startSheetResize}
            onKeyDown={onSheetHandleKeyDown}
            aria-label={t('拖动调整高度，点击切换半屏 / 全屏（也可用上下方向键调整）', 'Drag to resize, click to toggle half / full screen (arrow keys also work)')}
            title={t('拖动调整高度，点击切换全屏', 'Drag to resize, click to toggle full screen')}
            className="group flex h-5 shrink-0 cursor-ns-resize touch-none items-end justify-center focus-visible:outline-none"
          >
            <span
              className={`h-1 w-10 rounded-full transition ${
                dragging ? 'bg-ink/40' : 'bg-hairline-strong/60 group-hover:bg-hairline-strong group-focus-visible:bg-brand'
              }`}
              aria-hidden
            />
          </button>
        )}

        {/* 顶栏：只有一段对话时显示助手名，多段时变成对话标签；后台标签照常生成回复 */}
        <header className={`flex shrink-0 select-none items-center gap-1 border-b border-hairline pl-3 pr-2 ${sidebar ? 'h-12' : 'h-10'}`}>
          {conversations.length === 1 ? (
            <p className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-ink">
              <SparkIcon className="h-3.5 w-3.5 shrink-0 text-violet" />
              <span className="truncate">{t('AI 规划助手', 'AI planning assistant')}</span>
            </p>
          ) : (
            <div ref={tabsRef} role="tablist" aria-label={t('对话列表', 'Conversations')} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {conversations.map((c) => {
                const selected = c.id === active.id
                const title = conversationTitle(c)
                return (
                  <div
                    key={c.id}
                    className={`group flex h-7 max-w-[9rem] shrink-0 items-center rounded-md text-xs transition ${
                      selected ? 'bg-canvas-soft-2 text-ink' : 'text-mute hover:bg-canvas-soft hover:text-ink'
                    }`}
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveId(c.id)}
                      title={title}
                      className="flex h-full min-w-0 items-center gap-1.5 rounded-md pl-2 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {c.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" aria-label={t('正在回复', 'Replying')} />}
                      <span className="truncate">{title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => closeConversation(c.id)}
                      aria-label={t(`关闭对话：${title}`, `Close chat: ${title}`)}
                      className={`mr-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-mute transition hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                        selected ? '' : 'sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                    >
                      <CloseIcon className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <button
            type="button"
            onClick={createConversation}
            aria-label={t('新建对话', 'New chat')}
            title={t('新建对话', 'New chat')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <PlusIcon className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('关闭 AI 规划助手', 'Close AI planning assistant')}
            title={t('关闭', 'Close')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {showWelcome && (
            <>
              <div className="text-[13px] leading-relaxed text-body">
                <RichText text={WELCOME[lang]} />
              </div>
              <div className="space-y-1">
                {SUGGESTIONS[lang].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="block w-full rounded-lg bg-canvas-soft px-3 py-2 text-left text-[13px] leading-relaxed text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {turns.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-ink px-3.5 py-2.5 text-[13px] leading-relaxed text-on-ink">
                  {turn.text}
                </div>
              </div>
            ) : (
              <div key={i}>
                <div className="rounded-2xl bg-canvas-soft px-3.5 py-3 text-[13px] leading-relaxed text-body">
                {turn.text ? <RichText text={turn.text} /> : (
                  <p className="flex items-center gap-2 text-mute">
                    <span className="inline-flex gap-1" aria-hidden>
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hairline-strong" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hairline-strong [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hairline-strong [animation-delay:300ms]" />
                    </span>
                    {turn.searching ? t('正在联网核实…', 'Checking the web…') : t('正在思考…', 'Thinking…')}
                  </p>
                )}
                {turn.plan && <AppliedPlan plan={turn.plan} applied={isPlanApplied(turn.plan)} onRestore={onRestorePlan} />}
                </div>
                {/* 候选答案只挂在最后一轮：点一下即作为下一条消息发出 */}
                {i === turns.length - 1 && !busy && turn.quickReplies && turn.quickReplies.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {turn.quickReplies.map((reply) => (
                      <button
                        key={reply}
                        type="button"
                        onClick={() => void send(reply)}
                        className="rounded-full border border-hairline bg-canvas px-3 py-1.5 text-xs text-body transition hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                      >
                        {reply}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}

          {error && <p className="error-box text-[13px]">{error}</p>}
        </div>

        {/* 底部补一段安全区：手机全屏时输入区不会被 Home 指示条压住（无刘海设备上 env 为 0） */}
        <div className="shrink-0 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-1">
          <div className="flex items-end gap-1 rounded-xl border border-hairline bg-canvas p-1.5 transition focus-within:border-hairline-strong focus-within:ring-2 focus-within:ring-brand/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder={t('描述你的存储需求，Enter 发送', 'Describe your storage needs, Enter to send')}
              aria-label={t('描述你的存储需求', 'Describe your storage needs')}
              /* ai-composer-input：小屏下把字号顶到 16px，iOS 才不会一聚焦就把整页放大 */
              className="ai-composer-input max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-ink placeholder:text-mute focus:outline-none [field-sizing:content]"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || input.trim() === ''}
              aria-label={t('发送', 'Send')}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-on-ink transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-30"
            >
              <SendIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-mute">{t('AI 生成内容，请自行核实', 'AI-generated content, please verify')}</p>
        </div>
      </div>
    </>
  )
}
