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
import { STORAGE_NAMES } from '#/lib/storage-catalog'

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
const SHEET_MIN_HEIGHT = 360
const SHEET_TOP_GAP = 48

/** 底部面板的位置：高度，以及离布局视口底边的距离（手机软键盘弹起时不为 0） */
type SheetFrame = { height: number; bottom: number }

/**
 * 以「视觉视口」为准而不是 window.innerHeight：
 * 手机弹出软键盘时布局视口不变、视觉视口会变矮，fixed 定位的 bottom: 0 会落到键盘后面。
 * 把视觉视口下沿到布局视口下沿的这段距离算出来当作 bottom，面板就能贴在键盘上方。
 */
function sheetFrame(expanded: boolean): SheetFrame {
  const vv = window.visualViewport
  const vh = vv?.height ?? window.innerHeight
  const bottom = Math.max(0, window.innerHeight - (vv ? vv.offsetTop + vv.height : window.innerHeight))
  if (expanded) return { height: vh, bottom }
  const height = Math.min(Math.max(Math.round(vh * SHEET_RATIO), SHEET_MIN_HEIGHT), vh - SHEET_TOP_GAP)
  return { height, bottom }
}

function isCompact(): boolean {
  return (window.visualViewport?.width ?? window.innerWidth) < COMPACT_WIDTH
}

const SUGGESTIONS = [
  '128 卡 H100 训练集群，训练数据 500TB，该选哪种存储？',
  '3PB 医学影像归档，主要走 S3 协议，该怎么规划？',
  '在 K8s 上搭 AI 平台，PVC 和对象存储各要配多大？',
]

const WELCOME =
  '说说你的业务需求就行：数据量、访问协议、GPU 规模、预算都可以。我会先确认几个关键条件（候选项可以直接点选），再挑出合适的方案，把容量和带宽填进页面上的规划表单。\n\n不想回答问题？直接说「按经验来」，我会用行业常见值补齐参数，并列出每一条假设。\n\n我只回答存储、K8s、网络、GPU 和 AI 基础设施相关的问题。'

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

function MaximizeIcon({ className, maximized }: { className?: string; maximized: boolean }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className={className}>
      {maximized ? (
        // 还原：一个小框缩在角上
        <path d="M4 8h4V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      )}
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
  const bwUnit = plan.bandwidthUnit ?? 'GB/s'
  const rows: string[] = [`容量 ${plan.capacity.value} ${plan.capacity.unit}`]
  if (plan.readBandwidth) rows.push(`读 ${plan.readBandwidth} ${bwUnit}`)
  if (plan.writeBandwidth) rows.push(`写 ${plan.writeBandwidth} ${bwUnit}`)

  return (
    <div className="mt-3 rounded-lg border border-hairline bg-canvas p-3">
      <p className="eyebrow">已填入规划参数</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink">
        {plan.storages.map((k) => STORAGE_NAMES[k]).join('、')}
      </p>
      <p className="mt-1 font-mono text-xs text-body">{rows.join(' · ')}</p>
      {plan.note && <p className="mt-1.5 text-xs leading-relaxed text-mute">{plan.note}</p>}
      {plan.assumptions && plan.assumptions.length > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2">
          {/* 假设单独列出：用户一眼能挑出不成立的那条，直接回一句就能重算 */}
          <p className="eyebrow">所用假设（如有不符请告诉我）</p>
          <ul className="dot-list mt-1 text-xs">
            {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRestore(plan)}
        className="mt-2.5 inline-flex h-8 items-center rounded-md bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        {applied ? '查看规划结果' : '恢复这组参数'}
      </button>
      {!applied && <p className="mt-1.5 text-xs text-mute">表单已被改动，点击上方按钮可恢复为这组参数。</p>}
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
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(false)
  /** 小屏底部面板是否展开到全屏 */
  const [expanded, setExpanded] = useState(false)
  const [sheet, setSheet] = useState<SheetFrame | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
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
    const update = () => setSheet(sheetFrame(expanded))
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [expanded])

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
  }, [turns, busy])

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
  useEffect(() => () => abortRef.current?.abort(), [])

  const send = async (raw: string) => {
    const question = raw.trim()
    if (!question || busy) return

    // 历史里的助手消息已剥掉规划指令，模型不必再看自己上一轮的 JSON
    const history: ChatMessage[] = [...turns, { role: 'user' as const, text: question }]
      .filter((t) => t.text.trim() !== '')
      .map((t) => ({ role: t.role, content: t.text }))

    setTurns((prev) => [...prev, { role: 'user', text: question }, { role: 'assistant', text: '' }])
    setInput('')
    setError(null)
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    /** 只更新末尾那条助手消息 */
    const patchLast = (patch: (turn: Turn) => Turn) =>
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? patch(t) : t)))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        // 边缘 WAF 限流返回的是 Cloudflare 自己的 HTML 拦截页，解析不出我们的 JSON，
        // 所以按状态码兜一条明确的提示
        const detail = await res.json().catch(() => null)
        const fallback = res.status === 429 ? '请求过于频繁，请稍后再试。' : '请求失败，请稍后重试。'
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
            throw new Error(event.message ?? '生成失败，请重试。')
          }
        }
      }

      const { text, plan, quickReplies } = parseAssistantReply(answer)
      patchLast((t) => ({
        ...t,
        text: text || '（没有收到回复，请重试。）',
        plan,
        quickReplies,
        searching: false,
      }))
      if (plan) onApplyPlan(plan)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : '请求失败，请稍后重试。')
      // 丢掉空的助手占位，用户可以直接重问
      setTurns((prev) => (prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.text ? prev.slice(0, -1) : prev))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setTurns([])
    setError(null)
    setBusy(false)
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
        className="ai-fade fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
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
        AI 规划助手
      </button>

      {/*
        面板始终挂载，只切换可见性：卸载会丢掉消息区的滚动位置，
        而收起再打开要停在离开前的地方。visibility 的切换延后到淡出结束，
        这样退出动画能完整播完。
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="AI 规划助手"
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
          transition: open
            ? 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1), height 240ms cubic-bezier(0.32, 0.72, 0, 1), visibility 0s'
            : 'transform 220ms cubic-bezier(0.4, 0, 1, 1), visibility 0s linear 220ms',
        }}
      >
        {/* 底部面板顶上的抓手：点一下在半屏 / 全屏之间切换 */}
        {!sidebar && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? '收回半屏' : '展开到全屏'}
            className="flex h-4 shrink-0 items-end justify-center focus-visible:outline-none"
          >
            <span className="h-1 w-9 rounded-full bg-hairline-strong/60" aria-hidden />
          </button>
        )}

        <header
          className={`flex shrink-0 select-none items-center justify-between gap-3 border-b border-hairline px-4 ${
            sidebar ? 'py-3' : 'pb-2.5 pt-1.5'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <SparkIcon className="h-3.5 w-3.5 text-violet" />
                AI 规划助手
              </p>
              <p className="mt-0.5 text-xs text-mute">说出需求，自动选方案、填参数</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-2 py-1 text-xs text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              新对话
            </button>
          )}
          {!sidebar && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-pressed={expanded}
            aria-label={expanded ? '收回半屏' : '展开到全屏'}
            title={expanded ? '收回半屏' : '展开到全屏'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <MaximizeIcon className="h-3 w-3" maximized={expanded} />
          </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭 AI 规划助手"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {showWelcome && (
            <>
              <div className="rounded-2xl bg-canvas-soft px-3.5 py-3 text-[13px] leading-relaxed text-body">
                <RichText text={WELCOME} />
              </div>
              <div className="space-y-2">
                <p className="eyebrow">试试这些</p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="block w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-left text-[13px] leading-relaxed text-body transition hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
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
                <div className="max-w-[85%] rounded-2xl bg-ink px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
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
                    {turn.searching ? '正在联网核实…' : '正在思考…'}
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
        <div className="shrink-0 border-t border-hairline p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2">
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
              rows={2}
              maxLength={2000}
              placeholder="例如：256 卡训练集群，数据 1PB，需要 NFS 和 S3"
              aria-label="描述你的存储需求"
              /* ai-composer-input：小屏下把字号顶到 16px，iOS 才不会一聚焦就把整页放大 */
              className="ai-composer-input max-h-32 min-h-[3.25rem] flex-1 resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink transition placeholder:text-mute hover:border-hairline-strong focus:border-hairline-strong focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || input.trim() === ''}
              aria-label="发送"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-30"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-mute">Enter 发送，Shift + Enter 换行 · AI 生成内容，请自行核实</p>
        </div>
      </div>
    </>
  )
}
