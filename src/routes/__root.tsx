import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Storplan — 存储容量和性能规划' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
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
      <body className="min-h-screen bg-gray-50 font-sans antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
