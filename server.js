import { createServer } from 'node:http'
import handler from './dist/server/server.js'

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    const request = new Request(url.href, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([_, v]) => v !== undefined)
      ),
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
    })

    const response = await handler.fetch(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }

    res.end()
  } catch (error) {
    console.error('Server error:', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/plain')
    res.end('Internal Server Error')
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Storplan server listening on http://${HOST}:${PORT}`)
})
