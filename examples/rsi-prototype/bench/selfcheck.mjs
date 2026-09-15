#!/usr/bin/env node
// bench/selfcheck.mjs — proves every grader awards full marks to a correct
// implementation (and that graders themselves are correct). No LLM involved.
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const FIXTURES = {
  'server.mjs': `import http from 'node:http'
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200); res.end('HELLO-RSI'); return }
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('ok'); return }
  if (req.method === 'POST' && req.url === '/echo') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ method: 'POST', path: '/echo', body })) })
    return
  }
  res.writeHead(404); res.end('NOPE')
})
server.listen(0, '127.0.0.1', () => console.log('LISTEN ' + server.address().port))
`,
  'parser.mjs': `import process from 'node:process'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { text += c })
process.stdin.on('end', () => {
  const out = {}
  for (const raw of text.split(/\\r?\\n/)) {
    const line = raw.replace(/^\\uFEFF/, '').trim()
    if (!line) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  process.stdout.write(JSON.stringify(out, Object.keys(out).sort()) + '\\n')
})
`,
  'stats.mjs': `import process from 'node:process'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { text += c })
process.stdin.on('end', () => {
  const nums = text.split(/\\r?\\n/).map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite)
  if (nums.length === 0) { process.stdout.write('{"count":0}' + '\\n'); return }
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const sum = nums.reduce((a, b) => a + b, 0)
  process.stdout.write(JSON.stringify({ count: nums.length, sum, mean: sum / nums.length, median, min: sorted[0], max: sorted[sorted.length - 1] }) + '\\n')
})
`,
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-bench-selfcheck-'))
try {
  const tasks = { 'http-echo': ['server.mjs'], 'parser': ['parser.mjs'], 'stats': ['stats.mjs'] }
  for (const [task, files] of Object.entries(tasks)) {
    const dir = path.join(tmp, task)
    await fs.mkdir(dir, { recursive: true })
    for (const f of files) await fs.writeFile(path.join(dir, f), FIXTURES[f])
    const { grade } = await import(path.join(HERE, 'tasks', task, 'grade.mjs'))
    const res = await grade(dir)
    check(`grader '${task}' gives full marks to a correct implementation`, res.score === res.max, `${res.score}/${res.max}`)
  }
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nBENCH-SELFCHECK OK' : `\nBENCH-SELFCHECK FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1