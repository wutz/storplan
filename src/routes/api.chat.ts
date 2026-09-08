/**
 * POST /api/chat —— AI 规划助手的服务端出口。
 *
 * 浏览器只跟这个同源接口说话：上游地址、API Key、模型名全部留在服务端（Cloudflare Secret / .dev.vars），
 * 前端拿不到、构建产物里也不含。上游的 Anthropic SSE 在这里被转成一套最小事件协议再转发，
 * 顺带把 thinking / 工具调用等内部细节挡掉。
 */

import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { CHAT_LIMITS } from '#/lib/ai-chat'
import type { ChatMessage } from '#/lib/ai-chat'
import { buildSystemPrompt } from '#/lib/ai-system-prompt'

const DEFAULT_API_URL = 'https://api.blsc.dev'
const DEFAULT_MODEL = 'claude-opus-5'
const MAX_TOKENS = 1200
const MAX_WEB_SEARCHES = 3

/**
 * 来源限流。两道闸门：按调用方 IP（wrangler.toml 的 CHAT_IP_LIMITER）与全站总量
 * （CHAT_GLOBAL_LIMITER）。
 *
 * 注意其强度边界：Cloudflare 限流绑定的计数缓存在处理请求的那台机器上、异步同步，
 * 官方定性为「宽松、最终一致」。实测（预览环境）复用同一条 TCP 连接时第 7 次即被拦，
 * 而每次新建连接的请求会落到不同机器、各自从零计数，20 次连发全部放行。
 * 因此它能挡住浏览器与保持连接的脚本的连续刷量，挡不住每次重连的分布式刷量 ——
 * 要精确限额需要 Durable Object 计数或自定义域上的 WAF 限流规则。
 *
 * 绑定缺失或调用异常时放行 —— 配置问题不该让功能整体不可用；绑定是部署期配置，
 * 请求方无法把它“弄丢”。
 */
async function checkRateLimit(request: Request): Promise<Response | null> {
  // 绑定在类型上是必填，但运行时可能因配置缺失而不存在
  const { CHAT_IP_LIMITER, CHAT_GLOBAL_LIMITER } = env as Partial<Cloudflare.Env>
  type RateLimiter = Cloudflare.Env['CHAT_IP_LIMITER']
  // CF-Connecting-IP 由 Cloudflare 边缘写入，客户端无法伪造；本地 dev 没有该头，退回固定值
  const ip = request.headers.get('cf-connecting-ip') ?? 'local'

  const checks: Array<[RateLimiter | undefined, string, string]> = [
    [CHAT_IP_LIMITER, `ip:${ip}`, '提问太频繁了，请稍后再试（每分钟最多 8 次）。'],
    [CHAT_GLOBAL_LIMITER, 'global', '当前比较忙，AI 助手暂时限流，请稍后再试。'],
  ]

  for (const [limiter, key, message] of checks) {
    if (!limiter) continue
    try {
      const { success } = await limiter.limit({ key })
      if (!success) {
        return new Response(JSON.stringify({ error: message }), {
          status: 429,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': '60',
          },
        })
      }
    } catch {
      // 限流服务异常时放行，不影响正常提问
    }
  }
  return null
}

/** 转发给浏览器的事件（每行一条 SSE data） */
type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'search' }
  | { type: 'error'; message: string }
  | { type: 'done' }

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function parseMessages(input: unknown): ChatMessage[] | string {
  if (!input || typeof input !== 'object') return '请求格式不正确。'
  const raw = (input as { messages?: unknown }).messages
  if (!Array.isArray(raw) || raw.length === 0) return '请求里没有对话内容。'
  if (raw.length > CHAT_LIMITS.maxMessages) return '对话轮次太多了，请开一轮新对话。'

  const messages: ChatMessage[] = []
  let total = 0
  for (const item of raw) {
    if (!item || typeof item !== 'object') return '对话内容格式不对。'
    const { role, content } = item as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return '对话内容格式不对。'
    if (typeof content !== 'string' || content.trim() === '') return '对话内容不能为空。'
    if (content.length > CHAT_LIMITS.maxCharsPerMessage) return '这条消息太长了，请缩短后再试。'
    total += content.length
    if (total > CHAT_LIMITS.maxTotalChars) return '对话内容太长了，请开一轮新对话。'
    messages.push({ role, content })
  }
  if (messages[messages.length - 1]?.role !== 'user') return '对话内容格式不对。'
  return messages
}

/**
 * 把上游 SSE 拆成一条条 data 负载。Anthropic 的事件按 `event:` / `data:` 行成组发送，
 * 这里只关心 data 行的 JSON。
 */
function extractDataPayloads(chunk: string, buffer: { rest: string }): string[] {
  const text = buffer.rest + chunk
  const parts = text.split('\n')
  buffer.rest = parts.pop() ?? ''
  const payloads: string[] = []
  for (const line of parts) {
    const trimmed = line.trimEnd()
    if (trimmed.startsWith('data:')) payloads.push(trimmed.slice(5).trim())
  }
  return payloads
}

async function handleChat({ request }: { request: Request }): Promise<Response> {
  // 环境变量必须在请求内读取：Workers 在请求时才注入，模块作用域读到的是 undefined
  const apiKey = process.env.LLM_API_KEY
  const apiUrl = (process.env.LLM_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
  const model = process.env.LLM_MODEL || DEFAULT_MODEL

  if (!apiKey) {
    return json({ error: 'AI 助手还没配置：服务端缺少 LLM_API_KEY。' }, 503)
  }

  // 限流放在解析请求体之前：被限的请求不该再消耗解析与上游调用
  const limited = await checkRateLimit(request)
  if (limited) return limited

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: '请求不是合法的 JSON。' }, 400)
  }

  const parsed = parseMessages(body)
  if (typeof parsed === 'string') return json({ error: parsed }, 400)

  let upstream: Response
  try {
    upstream = await fetch(`${apiUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: request.signal,
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        stream: true,
        thinking: { type: 'disabled' },
        system: buildSystemPrompt(),
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_WEB_SEARCHES }],
        messages: parsed,
      }),
    })
  } catch {
    return json({ error: '连不上 AI 服务，请稍后再试。' }, 502)
  }

  if (!upstream.ok || !upstream.body) {
    // 上游错误正文可能带账号 / 路由信息，不透传给浏览器，只留状态码便于排查
    return json({ error: `AI 服务返回了错误（HTTP ${upstream.status}），请稍后再试。` }, 502)
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = upstream.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      const buffer = { rest: '' }
      // 只转发正文文本块：thinking 与工具调用参数留在服务端
      let textBlock = false

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const payload of extractDataPayloads(decoder.decode(value, { stream: true }), buffer)) {
            if (!payload || payload === '[DONE]') continue
            let event: any
            try {
              event = JSON.parse(payload)
            } catch {
              continue
            }
            switch (event.type) {
              case 'content_block_start':
                textBlock = event.content_block?.type === 'text'
                if (event.content_block?.type === 'server_tool_use' && event.content_block?.name === 'web_search') {
                  send({ type: 'search' })
                }
                break
              case 'content_block_delta':
                if (textBlock && event.delta?.type === 'text_delta' && event.delta.text) {
                  send({ type: 'delta', text: event.delta.text })
                }
                break
              case 'content_block_stop':
                textBlock = false
                break
              case 'error':
                send({ type: 'error', message: 'AI 服务生成时出错了，请再试一次。' })
                break
            }
          }
        }
        send({ type: 'done' })
      } catch {
        send({ type: 'error', message: '连接中断了，请再试一次。' })
      } finally {
        controller.close()
        reader.releaseLock()
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: handleChat,
    },
  },
})
