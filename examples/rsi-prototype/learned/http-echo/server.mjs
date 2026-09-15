// server.mjs — dependency-free HTTP echo server (Node built-ins only).
// Contract:
//   - listens on 127.0.0.1 with an OS-assigned random port,
//   - prints exactly `LISTEN <port>` on stdout once listening,
//   - GET /        -> 200, body exactly `HELLO-RSI`,
//   - GET /health  -> 200, body exactly `ok`,
//   - POST /echo   -> 200, JSON {method, path, body:<raw request body verbatim>},
//   - any other path-> 404, body exactly `NOPE`.
import { createServer } from 'node:http'

const HOST = '127.0.0.1'

const server = createServer((req, res) => {
  // Collect the raw request body; GET requests carry none, so 'end' fires
  // immediately and the body is empty.
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')

    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('HELLO-RSI')
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    } else if (req.method === 'POST' && req.url === '/echo') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ method: 'POST', path: '/echo', body }))
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('NOPE')
    }
  })
})

server.listen(0, HOST, () => {
  const { port } = server.address()
  console.log(`LISTEN ${port}`)
})