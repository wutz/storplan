/**
 * 根路由：全局 meta、样式与图标，以及包住各个页面的根布局。
 */
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Storplan — 存储容量与性能规划' },
      { name: 'description', content: '填入容量和带宽，一次对比 VastData、GPFS/Scale、Weka、XSKY XEOS 与 Ceph 的集群规模、硬件清单和性能指标。' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/logo.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootLayout,
})

function RootLayout() {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen bg-canvas-soft font-sans antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
