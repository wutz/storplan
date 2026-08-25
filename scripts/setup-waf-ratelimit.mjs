#!/usr/bin/env node
/**
 * 在自有域上为 /api/chat 建 WAF 限流规则（幂等：已存在同名规则则更新）。
 *
 * 为什么需要它：Worker 里的限流绑定按机器计数、宽松最终一致，换连接就能绕过；
 * WAF 限流在边缘按 colo 计数，且在请求进入 Worker 之前就拦下来，不消耗上游额度。
 * 但 WAF 只对自有域生效，*.workers.dev 预览域仍然只有绑定那层兜底。
 *
 * 用法：
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs           # 应用
 *   CLOUDFLARE_API_TOKEN=xxx node scripts/setup-waf-ratelimit.mjs --dry-run # 只打印将要提交的规则
 *
 * Token 需要（范围限定到该 zone 即可）：Zone → Zone → Read、Zone → WAF → Edit。
 *
 * 可用环境变量覆盖：ZONE_NAME / HOSTNAME / TARGET_PATH。
 */

const API = 'https://api.cloudflare.com/client/v4'
const token = process.env.CLOUDFLARE_API_TOKEN
const zoneName = process.env.ZONE_NAME || 'wutz.dev'
const hostname = process.env.HOSTNAME || 'storplan.wutz.dev'
const targetPath = process.env.TARGET_PATH || '/api/chat'
const dryRun = process.argv.includes('--dry-run')
const RULE_DESCRIPTION = 'storplan: rate limit /api/chat (AI assistant)'

if (!token) {
  console.error('缺少 CLOUDFLARE_API_TOKEN。需要 Zone:Read + WAF:Edit 权限，范围限定到目标 zone。')
  process.exit(1)
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  })
  const body = await res.json().catch(() => null)
  if (!body?.success) {
    const detail = body?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${res.status}`
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  return body.result
}

/**
 * 不同套餐能用的窗口与表达式字段差别很大，按 zone 实际套餐挑合法值：
 * Free 只有 10 秒窗口、10 秒封禁，且表达式只能用 Path（连 host 都不能匹配）。
 */
function limitsForPlan(planId) {
  const isFree = planId === 'free'
  const isPro = planId === 'pro'
  if (isFree) {
    return {
      // 一次问答要几十秒，正常用户不可能 10 秒内发 3 次
      period: 10,
      requestsPerPeriod: 3,
      mitigationTimeout: 10,
      expression: `(http.request.uri.path eq "${targetPath}")`,
      note: 'Free 套餐：窗口与封禁时长固定 10 秒，表达式仅支持 Path，因此该规则对本 zone 所有主机名的同名路径生效。',
    }
  }
  return {
    period: 60,
    requestsPerPeriod: 8,
    mitigationTimeout: isPro ? 60 : 300,
    expression: `(http.host eq "${hostname}" and http.request.uri.path eq "${targetPath}")`,
    note: `${planId} 套餐：可按主机名匹配，窗口 60 秒，与应用内绑定的 8 次/分钟保持一致。`,
  }
}

function buildRule(limits) {
  return {
    description: RULE_DESCRIPTION,
    expression: limits.expression,
    action: 'block',
    ratelimit: {
      characteristics: ['cf.colo.id', 'ip.src'], // Free / Pro 只支持按 IP 计数
      period: limits.period,
      requests_per_period: limits.requestsPerPeriod,
      mitigation_timeout: limits.mitigationTimeout,
    },
  }
}

const [zone] = await api(`/zones?name=${encodeURIComponent(zoneName)}`)
if (!zone) {
  console.error(`未找到 zone ${zoneName}（检查 token 范围是否覆盖该域名）。`)
  process.exit(1)
}

const planId = zone.plan?.legacy_id ?? 'free'
const limits = limitsForPlan(planId)
const rule = buildRule(limits)

console.log(`zone     ${zone.name}（${zone.id}）`)
console.log(`套餐     ${zone.plan?.name ?? planId}`)
console.log(`说明     ${limits.note}`)
console.log(`规则     ${limits.requestsPerPeriod} 次 / ${limits.period}s，超限 block ${limits.mitigationTimeout}s`)
console.log(`表达式   ${limits.expression}`)

if (dryRun) {
  console.log('\n--dry-run：未提交。规则体：')
  console.log(JSON.stringify(rule, null, 2))
  process.exit(0)
}

// 限流规则挂在 zone 的 http_ratelimit 入口 ruleset 上，可能还不存在
let ruleset
try {
  ruleset = await api(`/zones/${zone.id}/rulesets/phases/http_ratelimit/entrypoint`)
} catch (err) {
  if (err.status !== 404) throw err
  ruleset = null
}

if (!ruleset) {
  const created = await api(`/zones/${zone.id}/rulesets`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'default',
      kind: 'zone',
      phase: 'http_ratelimit',
      rules: [rule],
    }),
  })
  console.log(`\n已创建 http_ratelimit ruleset 并写入规则（ruleset ${created.id}）。`)
} else {
  const existing = ruleset.rules?.find((r) => r.description === RULE_DESCRIPTION)
  if (existing) {
    await api(`/zones/${zone.id}/rulesets/${ruleset.id}/rules/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(rule),
    })
    console.log(`\n已更新既有规则（rule ${existing.id}）。`)
  } else {
    await api(`/zones/${zone.id}/rulesets/${ruleset.id}/rules`, {
      method: 'POST',
      body: JSON.stringify(rule),
    })
    console.log(`\n已追加新规则到 ruleset ${ruleset.id}。`)
  }
}

console.log('生效后可验证：连发请求应在阈值后收到 429（由边缘返回，不再进入 Worker）。')
