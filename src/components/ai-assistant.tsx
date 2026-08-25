/**
 * AI 规划助手：右下角浮动按钮 + 多轮对话面板。
 *
 * 模型只做“听懂需求 → 选方案 → 定参数”，参数通过 onApplyPlan 写回页面顶部的规划表单，
 * 由本站既有的容量 / 性能计算逻辑出结果。样式沿用 DESIGN.md（发丝线 + 堆叠阴影 + 墨黑主 CTA）。
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

/** 「已应用」卡片：把模型定出的参数摊开给用户看，避免表单被悄悄改掉 */
function AppliedPlan({ plan, onFocusResults }: { plan: PlanDirective; onFocusResults: () => void }) {
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
        onClick={onFocusResults}
        className="mt-2.5 inline-flex h-8 items-center rounded-md bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        查看规划结果
      </button>
    </div>
  )
}

export function AiAssistant({ onApplyPlan, onFocusResults }: {
  onApplyPlan: (plan: PlanDirective) => void
  onFocusResults: () => void
}) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

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

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="fixed bottom-5 right-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-white transition hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        style={{ boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 8px 16px -4px rgba(0,0,0,0.12)' }}
      >
        <SparkIcon className="h-4 w-4" />
        AI 规划助手
      </button>
    )
  }

  const showWelcome = turns.length === 0

  return (
    <div
      role="dialog"
      aria-label="AI 规划助手"
      className="fixed inset-x-3 bottom-3 z-40 flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[36rem] sm:w-[26rem]"
      style={{
        height: 'min(36rem, calc(100dvh - 1.5rem))',
        boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 8px 16px -4px rgba(0,0,0,0.06), 0 24px 32px -8px rgba(0,0,0,0.09)',
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <SparkIcon className="h-3.5 w-3.5 text-violet" />
            AI 规划助手
          </p>
          <p className="mt-0.5 text-xs text-mute">描述需求，自动选方案并填参数</p>
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
              {turn.plan && <AppliedPlan plan={turn.plan} onFocusResults={onFocusResults} />}
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

      <div className="shrink-0 border-t border-hairline p-3">
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
            className="max-h-32 min-h-[3.25rem] flex-1 resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink transition placeholder:text-mute hover:border-hairline-strong focus:border-hairline-strong focus:outline-none focus:ring-2 focus:ring-ink/10"
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
  )
}
