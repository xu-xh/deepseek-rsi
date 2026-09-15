#!/usr/bin/env node
// bench: task 2 — line-based key=value parser with mechanical contract.
// Candidate: a single dependency-free Node file `parser.mjs` reading stdin:
//   - strip a UTF-8 BOM and carriage returns, skip blank lines,
//   - each line `key=value` (first '=' splits), keys sorted,
//   - output one compact JSON object per line face: {"k1":"v1","k2":"v2"}.
// Fixtures below cover BOM/CRLF/blank/normalized-order cases; grading compares
// the parsed value with a canonical `sort+stringify` transform of the input.
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const FIXTURES = [
  'k1=v1\nk2=v2\n',
  '\uFEFFb=2\na=1\r\n',
  'x=hello world\n\n  \ny=last\n',
  'dup=1\ndup=2\n',
  'empty=\nkey=value with = equals\n',
  'a=1\r\nb=2\r\nc=3\r\n',
]

const canonical = (text) => {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim()
    if (!line) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    out[line.slice(0, i)] = line.slice(i + 1)
  }
  return JSON.stringify(out, Object.keys(out).sort())
}

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'parser.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'parser.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  let ok = 0
  for (const fx of FIXTURES) {
    const r = spawnSync(runner, ['parser.mjs'], { cwd: dir, input: fx, encoding: 'utf-8', timeout: 5000 })
    const want = canonical(fx)
    const got = (r.stdout ?? '').trim()
    const pass = r.status === 0 && got === want
    if (pass) ok++
    checks.push({ name: `fixture ${JSON.stringify(fx.slice(0, 22))}...`, pass, got: `${r.status === 0 ? '' : `exit ${r.status}`}${got === want ? '' : ' -> mismatch'}` })
  }
  return { score: ok, max: FIXTURES.length, checks }
}