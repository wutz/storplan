/**
 * AI 规划助手：右下角浮动按钮 + 多轮对话面板。
 *
 * 模型只做“听懂需求 → 选方案 → 定参数”，参数通过 onApplyPlan 写回页面顶部的规划表单，
 * 由本站既有的容量 / 性能计算逻辑出结果。样式沿用 DESIGN.md（发丝线 + 堆叠阴影 + 墨黑主 CTA）。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** 面板几何：拖动与缩放后固定用绝对坐标定位，默认贴右下角 */
type Geometry = { left: number; top: number; width: number; height: number }

const DEFAULT_SIZE = { width: 416, height: 576 }
const MIN_SIZE = { width: 300, height: 320 }
const GEOMETRY_STORAGE_KEY = 'storplan.ai-panel.geometry'
/** 小于这个宽度按手机处理：默认最大化、不给拖动与缩放 */
const COMPACT_WIDTH = 640

/**
 * 以「视觉视口」为准而不是 window.innerWidth/Height：
 * 手机弹出软键盘时布局视口不变、视觉视口会变矮，只有跟着它算面板才不会被键盘盖住输入框。
 * offsetLeft/Top 是视觉视口相对布局视口的位移（iOS 键盘弹起时页面会被顶上去），
 * fixed 定位跟的是布局视口，所以要把这段位移补回去。
 */
function viewport() {
  const vv = window.visualViewport
  return {
    vw: vv?.width ?? window.innerWidth,
    vh: vv?.height ?? window.innerHeight,
    offsetLeft: vv?.offsetLeft ?? 0,
    offsetTop: vv?.offsetTop ?? 0,
  }
}

function marginFor(viewportWidth: number): number {
  return viewportWidth < COMPACT_WIDTH ? 8 : 20
}

function isCompact(): boolean {
  return viewport().vw < COMPACT_WIDTH
}

/** 最大化：铺满视觉视口，只留一圈边距 */
function maximizedGeometry(): Geometry {
  const { vw, vh, offsetLeft, offsetTop } = viewport()
  const margin = marginFor(vw)
  return { left: offsetLeft + margin, top: offsetTop + margin, width: vw - margin * 2, height: vh - margin * 2 }
}

function defaultGeometry(): Geometry {
  const { vw, vh, offsetLeft, offsetTop } = viewport()
  const margin = marginFor(vw)
  const width = Math.min(DEFAULT_SIZE.width, vw - margin * 2)
  const height = Math.min(DEFAULT_SIZE.height, vh - margin * 2)
  return { width, height, left: offsetLeft + vw - width - margin, top: offsetTop + vh - height - margin }
}

/** 保证面板始终留在视口内，且不小于最小尺寸（窗口缩小、恢复存档时都要过一遍） */
function clampGeometry(g: Geometry): Geometry {
  const { vw, vh, offsetLeft, offsetTop } = viewport()
  const width = Math.min(Math.max(g.width, MIN_SIZE.width), vw)
  const height = Math.min(Math.max(g.height, MIN_SIZE.height), vh)
  return {
    width,
    height,
    left: Math.min(Math.max(g.left, offsetLeft), offsetLeft + Math.max(vw - width, 0)),
    top: Math.min(Math.max(g.top, offsetTop), offsetTop + Math.max(vh - height, 0)),
  }
}

function readStoredGeometry(): Geometry | null {
  try {
    const raw = localStorage.getItem(GEOMETRY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Geometry>
    if (['left', 'top', 'width', 'height'].some((k) => !Number.isFinite(parsed[k as keyof Geometry]))) return null
    return clampGeometry(parsed as Geometry)
  } catch {
    return null
  }
}

const SUGGESTIONS = [
  '128 张 H100 训练集群，训练数据 500TB，选什么存储？',
  '要存 3PB 影像归档，主要是 S3 协议，怎么规划？',
  'K8s 上跑 AI 平台，需要 PVC 和对象存储，各配多大？',
]

const WELCOME =
  '描述你的业务需求就行 —— 数据量、协议、GPU 规模、预算约束都可以说。我会先把关键条件问清（可以直接点选项回答），再选方案并把容量与带宽填进上面的规划表单。\n\n想跳过提问就说「按经验来」，我用行业常见值补齐，并把假设逐条列出来。\n\n只聊存储、K8s、网络、GPU 与 AI 基础设施相关的问题。'

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

function GripIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="4.5" cy="3" r="0.9" />
      <circle cx="7.5" cy="3" r="0.9" />
      <circle cx="4.5" cy="6" r="0.9" />
      <circle cx="7.5" cy="6" r="0.9" />
      <circle cx="4.5" cy="9" r="0.9" />
      <circle cx="7.5" cy="9" r="0.9" />
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
          <p className="eyebrow">假设（不成立就告诉我）</p>
          <ul className="dot-list mt-1 text-xs">
            {plan.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => onRestore(plan)}
        className="mt-2.5 inline-flex h-8 items-center rounded-md bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        {applied ? '查看规划结果' : '恢复这组参数并查看'}
      </button>
      {!applied && <p className="mt-1.5 text-xs text-mute">表单参数已被改动，点上面按钮可还原成这组。</p>}
    </div>
  )
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
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [maximized, setMaximized] = useState(false)
  // 收放动画的锚点：启动按钮中心在面板内的坐标
  const [transformOrigin, setTransformOrigin] = useState('100% 100%')

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  /** 最大化前的位置尺寸，还原时用 */
  const restoreRef = useRef<Geometry | null>(null)
  /** 面板隐藏期间不自动滚到底，这样再打开时停在离开前的位置 */
  const openRef = useRef(open)
  openRef.current = open

  // 首帧不读 localStorage，避免 SSR 与客户端渲染不一致
  useEffect(() => {
    // 手机上默认最大化：屏幕本来就窄，浮窗式的小卡片只会让对话更难读
    if (isCompact()) {
      setMaximized(true)
      setGeometry(maximizedGeometry())
      return
    }
    setGeometry(readStoredGeometry() ?? defaultGeometry())
  }, [])

  useEffect(() => {
    // 最大化是临时状态，别把它当成用户选的窗口尺寸存下来
    if (!geometry || maximized) return
    try {
      localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(geometry))
    } catch {
      // 隐私模式下写不了，忽略即可
    }
  }, [geometry, maximized])

  // 视口变化后把面板拉回视口内；最大化时直接跟着视口重算 ——
  // 手机软键盘弹起走的是 visualViewport 的 resize/scroll，window resize 不一定触发
  useEffect(() => {
    const onResize = () => {
      setGeometry((g) => (maximized ? maximizedGeometry() : g ? clampGeometry(g) : g))
    }
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('scroll', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('scroll', onResize)
    }
  }, [maximized])

  useEffect(() => {
    // 手机上不自动聚焦：一打开就顶起键盘，反而看不见欢迎语和示例
    if (open && !isCompact()) inputRef.current?.focus()
  }, [open])

  // 手机上铺满屏幕时锁住背后页面，避免滑动对话内容时把整页也带着滚
  useEffect(() => {
    if (!open || !maximized || !isCompact()) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open, maximized])

  useEffect(() => {
    if (!openRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // 点面板外自动收起（点启动按钮除外，否则会“关了又开”）
    const onPointerDown = (e: PointerEvent) => {
      // contains() 只接受 Node，事件目标万一不是（合成事件可能给 window），先挡一道
      const target = e.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || launcherRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open])

  /**
   * macOS「缩放特效」式的开合：窗口从 Dock 图标里长出来、收起时缩回图标。
   * 做法是把 transform-origin 定到启动按钮中心（换算成面板内坐标），收起时 scale 到极小 ——
   * 面板无论被拖到哪儿，都朝那颗按钮飞。
   *
   * 几何一确定就先算好（而不是等到开合那一刻）：transform-origin 不参与过渡、改了立即生效，
   * 若与展开同一次提交才写入，第一帧仍用旧原点，首次展开就会从面板角上而不是按钮上长出来。
   * 面板可见时 scale 为 1，此时改原点不影响成像，所以拖动 / 缩放中跟着重算是安全的。
   */
  useLayoutEffect(() => {
    const launcher = launcherRef.current?.getBoundingClientRect()
    if (!launcher || !geometry) return
    setTransformOrigin(
      `${launcher.left + launcher.width / 2 - geometry.left}px ${launcher.top + launcher.height / 2 - geometry.top}px`,
    )
  }, [open, geometry])

  /**
   * 拖动（抓卡头）与缩放（抓左上角手柄）。缩放固定右下角不动，
   * 因为面板默认贴在右下，这样手感和窗口一致。
   */
  const startInteraction = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    // 最大化时窗口就该钉死，拖不动也拉不了
    if (!geometry || maximized || e.button !== 0) return
    if (mode === 'move' && (e.target as HTMLElement).closest('button, textarea, a')) return
    e.preventDefault()

    const start = { x: e.clientX, y: e.clientY, geo: geometry }
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (mode === 'move') {
        setGeometry(clampGeometry({ ...start.geo, left: start.geo.left + dx, top: start.geo.top + dy }))
        return
      }
      const right = start.geo.left + start.geo.width
      const bottom = start.geo.top + start.geo.height
      const width = Math.max(MIN_SIZE.width, Math.min(start.geo.width - dx, right))
      const height = Math.max(MIN_SIZE.height, Math.min(start.geo.height - dy, bottom))
      setGeometry(clampGeometry({ width, height, left: right - width, top: bottom - height }))
    }
    const onUp = () => window.removeEventListener('pointermove', onMove)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  const toggleMaximize = () => {
    if (maximized) {
      setMaximized(false)
      setGeometry(clampGeometry(restoreRef.current ?? defaultGeometry()))
      return
    }
    restoreRef.current = geometry
    setMaximized(true)
    setGeometry(maximizedGeometry())
  }

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
        text: text || '（没有收到回复内容，请重试。）',
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
        className="ai-fade fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
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
        className="ai-panel fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas"
        style={{
          left: geometry?.left ?? 0,
          top: geometry?.top ?? 0,
          width: geometry?.width ?? DEFAULT_SIZE.width,
          height: geometry?.height ?? DEFAULT_SIZE.height,
          boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 8px 16px -4px rgba(0,0,0,0.06), 0 24px 32px -8px rgba(0,0,0,0.09)',
          transformOrigin,
          opacity: open ? 1 : 0,
          /*
            收起时缩到极小、落在启动按钮上。终态缩放比就是落点误差：面板被拖远后，
            末帧中心会停在「按钮 → 面板中心」这条线的 scale 处（0.04 时约差 30px），
            所以取 0.01 —— 既基本压到按钮上，又不用 scale(0)（非可逆矩阵，个别浏览器会另眼相看）。
          */
          transform: open ? 'scale(1)' : 'scale(0.01)',
          visibility: geometry && open ? 'visible' : 'hidden',
          /*
            展开：形变走 macOS 那条“起步快、尾段长”的曲线，透明度更快补齐，避免看起来是块半透明玻璃在放大。
            收起：略快一点、尾段加速（ease-in），透明度延后再退，让面板在缩小过程中一直看得见，
            最后 visibility 在动画结束那刻才切，否则退出动画会被截断。
          */
          transition: open
            ? 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1), opacity 160ms ease-out, visibility 0s'
            : 'transform 240ms cubic-bezier(0.4, 0, 0.7, 0.2), opacity 200ms ease-in 60ms, visibility 0s linear 240ms',
        }}
      >
        {/* 左上角缩放手柄：拖动时右下角固定不动；最大化时没有可拉的余地，收起来 */}
        {!maximized && (
          <button
            type="button"
            aria-label="拖动以调整对话框大小"
            onPointerDown={startInteraction('resize')}
            className="absolute left-1 top-1 z-10 hidden h-6 w-6 touch-none items-center justify-center rounded-md text-hairline-strong hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20 sm:inline-flex"
          >
            {/* 圆角 + overflow-hidden 会把最角上那几像素裁掉，所以手柄向内缩一点，别贴死角 */}
            <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="h-3 w-3">
              <path d="M10 2H2v8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <header
          onPointerDown={startInteraction('move')}
          onDoubleClick={() => !maximized && setGeometry(defaultGeometry())}
          title={maximized ? undefined : '拖动可移动位置，双击恢复默认位置'}
          className={`flex shrink-0 touch-none select-none items-center justify-between gap-3 border-b border-hairline px-4 py-3 ${
            maximized ? '' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {!maximized && <GripIcon className="h-3 w-3 shrink-0 text-hairline-strong" aria-hidden />}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <SparkIcon className="h-3.5 w-3.5 text-violet" />
                AI 规划助手
              </p>
              <p className="mt-0.5 text-xs text-mute">描述需求，自动选方案并填参数</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="rounded-md px-2 py-1 text-xs text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
            >
              新对话
            </button>
          )}
          <button
            type="button"
            onClick={toggleMaximize}
            aria-pressed={maximized}
            aria-label={maximized ? '还原对话框大小' : '最大化对话框'}
            title={maximized ? '还原大小' : '最大化'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
          >
            <MaximizeIcon className="h-3 w-3" maximized={maximized} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭 AI 规划助手"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
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
                    className="block w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-left text-[13px] leading-relaxed text-body transition hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
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
                    {turn.searching ? '正在联网查证…' : '正在分析…'}
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
                        className="rounded-full border border-hairline bg-canvas px-3 py-1.5 text-xs text-body transition hover:border-hairline-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10"
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
              placeholder="例如：256 张卡的训练集群，数据 1PB，要 NFS 和 S3"
              aria-label="描述你的存储需求"
              /* ai-composer-input：小屏下把字号顶到 16px，iOS 才不会一聚焦就把整页放大 */
              className="ai-composer-input max-h-32 min-h-[3.25rem] flex-1 resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink transition placeholder:text-mute hover:border-hairline-strong focus:border-hairline-strong focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={busy || input.trim() === ''}
              aria-label="发送"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-30"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-mute">Enter 发送 · Shift + Enter 换行 · 内容由 AI 生成，请自行复核</p>
        </div>
      </div>
    </>
  )
}
