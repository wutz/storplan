/**
 * 根路由：全局 meta、样式与图标，以及包住各个页面的根布局。
 * 语言与主题偏好在 loader 里读出（服务端读 cookie），首屏即按用户偏好渲染。
 */
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'
import { PrefsProvider, THEME_BOOT_SCRIPT, readPrefs } from '#/lib/i18n'

const META = {
  zh: {
    title: 'Storplan — 存储容量与性能规划',
    description: '填入容量和带宽，一次对比 VastData、GPFS ECE、Weka、XSKY XEOS 与 Ceph 的集群规模、硬件清单和性能指标。',
  },
  en: {
    title: 'Storplan — Storage Capacity & Performance Planning',
    description: 'Enter capacity and bandwidth to compare cluster size, bill of materials and performance of VastData, GPFS ECE, Weka, XSKY XEOS and Ceph side by side.',
  },
}

export const Route = createRootRoute({
  loader: () => readPrefs(),
  head: ({ loaderData }) => {
    const meta = META[loaderData?.lang ?? 'zh']
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light dark' },
        { title: meta.title },
        { name: 'description', content: meta.description },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' },
      ],
    }
  },
  component: RootLayout,
})

function RootLayout() {
  const prefs = Route.useLoaderData()
  return (
    // 主题 class 由内联脚本在首帧前写入，服务端不知道系统明暗，这里允许不一致
    <html lang={prefs.lang === 'en' ? 'en' : 'zh-CN'} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-screen bg-canvas-soft font-sans antialiased">
        <PrefsProvider initial={prefs}>
          <Outlet />
        </PrefsProvider>
        <Scripts />
      </body>
    </html>
  )
}
