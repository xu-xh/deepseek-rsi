#!/usr/bin/env node
// bench: natural-defect task 2 — a loop controller must terminate.
// Origin: real defect in RSIAgent-style orchestration found in our runs —
// a loop whose only stop condition never fires (run-1 commit loop) spins
// until budget dies. Candidate must implement the documented termination rule.
// Candidate: one dependency-free Node file `loop.mjs` reading stdin lines
// ('ok' | 'fail'): a 'fail' increments the streak, 'ok' resets it; when the
// streak reaches 3 print `STOP-3` and exit 0; at EOF print `EOF-<streak>` exit 0.
// Inputs with 0..2 trailing fails must NOT hang (timeout = failure).
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const INPUTS = [
  ['fail\nfail\nfail\n', 'STOP-3'],
  ['ok\nfail\nfail\nfail\n', 'STOP-3'],
  ['ok\nok\nfail\nfail\n', 'EOF-2'],
  ['', 'EOF-0'],
  ['ok\nfail\nok\nfail\nfail\nfail\n', 'STOP-3'],
]

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'loop.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'loop.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  let ok = src ? 1 : 0 // presence counts
  for (const [input, want] of INPUTS) {
    const r = spawnSync(runner, ['loop.mjs'], { cwd: dir, input, encoding: 'utf-8', timeout: 4000 })
    const pass = r.status === 0 && (r.stdout ?? '').trim() === want
    if (pass) ok++
    checks.push({ name: `input ${JSON.stringify(input.slice(0, 16))}...`, pass, got: pass ? 'ok' : `exit=${r.status}${r.error ? ' TIMEOUT' : ''} out=${JSON.stringify((r.stdout ?? '').trim()).slice(0, 40)}` })
  }
  return { score: ok, max: INPUTS.length + 1, checks }
}