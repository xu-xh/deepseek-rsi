#!/usr/bin/env node
// bench: task 1 — HTTP echo server with a mechanical contract.
// Candidate: a single dependency-free Node file `server.mjs` that:
//   - starts an HTTP server and prints `LISTEN <port>` on stdout,
//   - GET /          -> 200, body exactly `HELLO-RSI`,
//   - GET /health    -> 200, body exactly `ok`,
//   - POST /echo     -> 200, JSON body {method, path, body:<the raw request body>},
//   - any other path -> 404, body exactly `NOPE`.
// Grading is purely behavioral: spawn, probe, kill. No model in the loop.
import { spawn } from 'node:child_process'

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const server = spawn(runner, ['server.mjs'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  let port = null
  let stdout = ''
  let stderr = ''

  const waitPort = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no LISTEN line within 10s')), 10_000)
    server.stdout.on('data', (d) => {
      stdout += d
      const m = stdout.match(/LISTEN\s+(\d+)/)
      if (m) { clearTimeout(t); port = Number(m[1]); resolve() }
    })
  })
  const exited = new Promise((resolve) => server.on('exit', (code) => resolve(code)))

  const probe = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, body, headers: body !== undefined ? { 'content-type': 'text/plain' } : undefined,
    })
    return { status: res.status, text: await res.text() }
  }

  try {
    await waitPort
    let r = await probe('GET', '/')
    checks.push({ name: 'GET / -> 200 HELLO-RSI', pass: r.status === 200 && r.text === 'HELLO-RSI', got: `${r.status} ${JSON.stringify(r.text)}` })
    r = await probe('GET', '/health')
    checks.push({ name: 'GET /health -> 200 ok', pass: r.status === 200 && r.text === 'ok', got: `${r.status} ${JSON.stringify(r.text)}` })
    r = await probe('POST', '/echo', '{"a":1}\n')
    let echoOk = false
    try { const j = JSON.parse(r.text); echoOk = r.status === 200 && j.method === 'POST' && j.path === '/echo' && j.body === '{"a":1}\n' } catch { /* not json */ }
    checks.push({ name: 'POST /echo echoes method/path/body', pass: echoOk, got: `${r.status} ${r.text.slice(0, 80)}` })
    r = await probe('GET', '/missing')
    checks.push({ name: 'GET /missing -> 404 NOPE', pass: r.status === 404 && r.text === 'NOPE', got: `${r.status} ${JSON.stringify(r.text)}` })
  } catch (err) {
    checks.push({ name: 'server became reachable', pass: false, got: `${err?.message} | stderr: ${stderr.slice(0, 200)}` })
  } finally {
    server.kill('SIGTERM')
    await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))])
    server.kill('SIGKILL')
  }

  const score = checks.filter((c) => c.pass).length
  return { score, max: checks.length, checks, stderr: stderr.slice(0, 500) }
}