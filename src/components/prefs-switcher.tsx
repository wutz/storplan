/**
 * 顶栏右侧的语言与主题切换：语言在中 / 英之间切换，主题在「跟随系统 / 白天 / 夜间」三档间循环。
 */
import { usePrefs } from '#/lib/i18n'
import type { ThemePref } from '#/lib/i18n'

const THEME_CYCLE: ThemePref[] = ['system', 'light', 'dark']

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M13.5 9.6A5.5 5.5 0 0 1 6.4 2.5a5.5 5.5 0 1 0 7.1 7.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 14h5M8 11v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

const BTN = 'inline-flex h-8 shrink-0 items-center justify-center rounded-md px-2 text-sm text-body transition hover:bg-canvas-soft-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40'

export function PrefsSwitcher() {
  const { lang, setLang, theme, setTheme, t } = usePrefs()

  const themeLabel = {
    system: t('主题：跟随系统', 'Theme: system'),
    light: t('主题：白天', 'Theme: light'),
    dark: t('主题：夜间', 'Theme: dark'),
  }[theme]
  const nextTheme = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon

  return (
    <>
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className={`${BTN} w-8 px-0`}
        aria-label={themeLabel}
        title={themeLabel}
      >
        <Icon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        className={`${BTN} font-mono text-xs`}
        aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
        title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      >
        {lang === 'zh' ? 'EN' : '中'}
      </button>
    </>
  )
}
