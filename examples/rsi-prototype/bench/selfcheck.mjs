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
  'trio config.json': `{"k1":"v1","k2":"v2"}\n`,
  'trio reader.mjs': `import fs from 'node:fs'
const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const parts = Object.keys(cfg).sort().map((k) => k + '=' + cfg[k])
process.stdout.write('CONFIG-OK: ' + parts.join(',') + '\\n')
`,
  'trio checker.mjs': `import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const cfg = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const out = execFileSync(process.execPath, ['reader.mjs'], { cwd: process.cwd(), encoding: 'utf8' })
const missing = Object.keys(cfg).filter((k) => !out.includes(k + '='))
if (missing.length) { process.stdout.write('MISSING: ' + missing.join(',') + '\\n'); process.exit(1) }
process.stdout.write('OK\\n')
`,
  'validate.mjs': `import process from 'node:process'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { text += c })
process.stdin.on('end', () => {
  const lines = text.replace(/^\\uFEFF/, '').split(/\\r?\\n/).filter((l) => l.trim() !== '')
  let n = 0, m = 0
  const out = []
  for (const l of lines) {
    if (/^[A-Z]{2}[0-9]{4}$/.test(l)) { n++; out.push('OK') } else { m++; out.push('BAD ' + l) }
  }
  process.stdout.write(out.join('\\n') + (out.length ? '\\n' : '') + n + ' ok, ' + m + ' bad\\n')
})
`,
  'chain a.mjs': `console.log('A:OK-v1')\n`,
  'chain b.mjs': `import { execFileSync } from 'node:child_process'
const out = execFileSync(process.execPath, ['a.mjs'], { encoding: 'utf8' })
process.stdout.write('B:OK: ' + out.trim().split('\\n')[0] + '\\n')
`,
  'chain c.mjs': `import { execFileSync } from 'node:child_process'
const out = execFileSync(process.execPath, ['b.mjs'], { encoding: 'utf8' })
process.stdout.write('C:OK: ' + out.trim().split('\\n')[0] + '\\n')
`,
  // natural-defect tasks: correct implementations
  'cli-forms cli.mjs': `const a = process.argv.slice(2)
let mode = null, name = null
for (let i = 0; i < a.length; i++) {
  if (a[i] === '--mode') mode = a[++i]
  else if (a[i] === '--name') name = a[++i]
  else if (a[i].startsWith('--mode=')) mode = a[i].slice(7)
  else if (a[i].startsWith('--name=')) name = a[i].slice(7)
  else if (mode === null) mode = a[i]
  else if (name === null) name = a[i]
}
if (mode === null || name === null) { process.stderr.write('usage: cli.mjs --mode M --name N | M N\\n'); process.exit(2) }
process.stdout.write('MODE=' + mode + ' NAME=' + name + '\\n')
`,
  'loop-terminate loop.mjs': `import process from 'node:process'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { text += c })
process.stdin.on('end', () => {
  let streak = 0
  for (const line of text.split('\\n')) {
    const t = line.trim()
    if (t === 'fail') { streak++; if (streak === 3) { process.stdout.write('STOP-3\\n'); return } }
    else if (t === 'ok') streak = 0
  }
  process.stdout.write('EOF-' + streak + '\\n')
})
`,
  'home-fallback paths.mjs': `import process from 'node:process'
import os from 'node:os'
import path from 'node:path'
const p = process.env.CFG_DIR || (process.env.HOME ? path.join(process.env.HOME, '.rsi-cfg') : path.join(os.tmpdir(), 'rsi-cfg'))
process.stdout.write('CFG=' + p + '\\n')
`,
  'write-once archive.mjs': `import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const src = process.argv[2]
const outRoot = path.join(process.cwd(), 'out')
const h = crypto.createHash('sha256')
for (const f of fs.readdirSync(src).sort()) h.update(f).update(fs.readFileSync(path.join(src, f)))
const name = 'arc-' + h.digest('hex').slice(0, 16)
const dest = path.join(outRoot, name)
if (fs.existsSync(dest)) { process.stdout.write('EXISTS\\n'); process.exit(3) }
fs.mkdirSync(dest, { recursive: true })
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f))
process.stdout.write('ARCHIVED ' + name + '\\n')
`,
  'tdz-fix broken.mjs': `const V = 42
const OUT = \`VALUE=\${V}\`
process.stdout.write(OUT + '\\n')
`,
}

// Negative samples: implementations carrying the historical defect MUST score
// below max — this mechanically proves each grader discriminates.
const NEG = {
  'cli-forms': {
    files: ['cli.mjs'],
    content: {
      'cli.mjs': `const [m, n] = process.argv.slice(2)
if (!m || !n) { process.stderr.write('usage\\n'); process.exit(2) }
process.stdout.write('MODE=' + m + ' NAME=' + n + '\\n')
`, // positional-only → flag forms fail
    },
  },
  'loop-terminate': {
    files: ['loop.mjs'],
    content: {
      'loop.mjs': `import process from 'node:process'
let text = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { text += c })
process.stdin.on('end', () => {
  let streak = 0
  for (const line of text.split('\\n')) { if (line.trim() === 'fail') streak++; else if (line.trim() === 'ok') streak = 0 }
  process.stdout.write('EOF-' + streak + '\\n')
})`, // never prints STOP-3 regardless of streak → termination rule missing
    },
  },
  'home-fallback': {
    files: ['paths.mjs'],
    content: {
      'paths.mjs': `import process from 'node:process'
const p = process.env.CFG_DIR || process.env.HOME + '/.rsi-cfg'
if (!process.env.CFG_DIR && !process.env.HOME) throw new Error('no home')
process.stdout.write('CFG=' + p + '\\n')
`, // assumes HOME exists → crashes when both env vars are absent
    },
  },
  'write-once': {
    files: ['archive.mjs'],
    content: {
      'archive.mjs': `import fs from 'node:fs'
import path from 'node:path'
const src = process.argv[2]
const outRoot = process.env.ARCHIVE_OUT || 'out'
const name = 'arc-fixed'
const dest = path.join(outRoot, name)
fs.mkdirSync(dest, { recursive: true })
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dest, f))
process.stdout.write('ARCHIVED ' + name + '\\n')
`, // fixed name → second run silently overwrites instead of EXISTS/exit 3
    },
  },
}

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-bench-selfcheck-'))
try {
  const tasks = {
    'http-echo': ['server.mjs'],
    'parser': ['parser.mjs'],
    'stats': ['stats.mjs'],
    'trio': ['config.json', 'reader.mjs', 'checker.mjs'],
    'validate': ['validate.mjs'],
    'chain': ['a.mjs', 'b.mjs', 'c.mjs'],
    'cli-forms': ['cli.mjs'],
    'loop-terminate': ['loop.mjs'],
    'home-fallback': ['paths.mjs'],
    'write-once': ['archive.mjs'],
    'tdz-fix': ['broken.mjs'],
  }
  for (const [task, files] of Object.entries(tasks)) {
    const dir = path.join(tmp, task)
    await fs.mkdir(dir, { recursive: true })
    for (const f of files) {
      const content = FIXTURES[`${task} ${f}`] ?? FIXTURES[f]
      await fs.writeFile(path.join(dir, f), content)
    }
    const { grade } = await import(path.join(HERE, 'tasks', task, 'grade.mjs'))
    const res = await grade(dir)
    check(`grader '${task}' gives full marks to a correct implementation`, res.score === res.max, `${res.score}/${res.max}`)
  }
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

// Negative samples: each grader must score a defect-carrying implementation below max.
{
  const negTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-bench-neg-'))
  try {
    for (const [task, spec] of Object.entries(NEG)) {
      const dir = path.join(negTmp, `neg-${task}`)
      await fs.mkdir(dir, { recursive: true })
      for (const f of spec.files) await fs.writeFile(path.join(dir, f), spec.content[f])
      const { grade } = await import(path.join(HERE, 'tasks', task, 'grade.mjs'))
      const res = await grade(dir)
      check(`grader '${task}' rejects its historical defect (score < max)`, res.score < res.max, `${res.score}/${res.max}`)
    }
    // tdz-fix negative: the unfixed file must fail.
    {
      const { grade, TDZ_BROKEN } = await import(path.join(HERE, 'tasks', 'tdz-fix', 'grade.mjs'))
      const dir = path.join(negTmp, 'neg-tdz-fix')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, 'broken.mjs'), TDZ_BROKEN)
      const res = await grade(dir)
      check("grader 'tdz-fix' rejects the unfixed TDZ file", res.score < res.max, `${res.score}/${res.max}`)
    }
  } finally {
    await fs.rm(negTmp, { recursive: true, force: true })
  }
}

console.log(failures === 0 ? '\nBENCH-SELFCHECK OK' : `\nBENCH-SELFCHECK FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1