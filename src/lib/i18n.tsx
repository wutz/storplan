/**
 * 界面语言与主题偏好。
 *
 * 语言写在 cookie 里：服务端渲染时就能读到，首屏直接输出对应语言，不会先闪一下中文再切英文。
 * 没有 cookie 时按浏览器的 Accept-Language 猜。
 * 主题同样写 cookie，但实际的明暗由 <head> 里的内联脚本在首帧前加到 <html class="dark">，
 * 「跟随系统」时还要读 prefers-color-scheme，这只有浏览器知道。
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie, getRequestHeader } from '@tanstack/react-start/server'

export type Lang = 'zh' | 'en'
export type ThemePref = 'system' | 'light' | 'dark'

export const LANG_COOKIE = 'storplan-lang'
export const THEME_COOKIE = 'storplan-theme'
const ONE_YEAR = 60 * 60 * 24 * 365

function readClientCookie(name: string): string | undefined {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`
}

function pickLang(cookie: string | undefined, acceptLanguage: string | undefined): Lang {
  if (cookie === 'zh' || cookie === 'en') return cookie
  // 首选语言不是中文时给英文；Accept-Language 缺失（爬虫等）按中文
  const first = acceptLanguage?.split(',')[0]?.trim().toLowerCase()
  return first && !first.startsWith('zh') ? 'en' : 'zh'
}

function pickTheme(cookie: string | undefined): ThemePref {
  return cookie === 'light' || cookie === 'dark' ? cookie : 'system'
}

/** 在根路由 loader 里调用：服务端读请求 cookie / 头，客户端读 document.cookie */
export const readPrefs = createIsomorphicFn()
  .server(() => ({
    lang: pickLang(getCookie(LANG_COOKIE), getRequestHeader('accept-language')),
    theme: pickTheme(getCookie(THEME_COOKIE)),
  }))
  .client(() => ({
    lang: pickLang(readClientCookie(LANG_COOKIE), navigator.language),
    theme: pickTheme(readClientCookie(THEME_COOKIE)),
  }))

/**
 * 首帧前执行的主题脚本：按 cookie 决定明暗，「跟随系统」时读 prefers-color-scheme 并监听系统切换。
 * 以字符串内联进 <head>，避免等 JS 包加载完才变暗造成白屏闪烁。
 */
export const THEME_BOOT_SCRIPT = `(function(){
var d=document.documentElement,m=window.matchMedia('(prefers-color-scheme: dark)');
function pref(){var c=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);return c?c[1]:'system'}
function apply(){var p=pref(),dark=p==='dark'||(p!=='light'&&m.matches);d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light'}
apply();m.addEventListener('change',apply);window.__applyTheme=apply;
})()`

declare global {
  interface Window {
    __applyTheme?: () => void
  }
}

/** 当前语言：规划器等纯函数模块里的报错文案按它挑语言（规划只在浏览器里跑） */
let currentLang: Lang = 'zh'

/** 在非 React 模块里按当前语言挑文案 */
export function tr(zh: string, en: string): string {
  return currentLang === 'en' ? en : zh
}

type PrefsContext = {
  lang: Lang
  setLang: (lang: Lang) => void
  theme: ThemePref
  setTheme: (theme: ThemePref) => void
  /** t('中文', 'English')：按当前语言挑一个 */
  t: (zh: string, en: string) => string
}

const Ctx = createContext<PrefsContext | null>(null)

export function PrefsProvider({ initial, children }: { initial: { lang: Lang; theme: ThemePref }; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial.lang)
  const [theme, setThemeState] = useState<ThemePref>(initial.theme)
  currentLang = lang

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    writeCookie(LANG_COOKIE, next)
    setLangState(next)
  }, [])

  const setTheme = useCallback((next: ThemePref) => {
    writeCookie(THEME_COOKIE, next)
    setThemeState(next)
    window.__applyTheme?.()
  }, [])

  const t = useCallback((zh: string, en: string) => (lang === 'en' ? en : zh), [lang])

  return <Ctx.Provider value={{ lang, setLang, theme, setTheme, t }}>{children}</Ctx.Provider>
}

export function usePrefs(): PrefsContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return ctx
}
