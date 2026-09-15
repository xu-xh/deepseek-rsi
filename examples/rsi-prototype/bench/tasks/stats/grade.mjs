#!/usr/bin/env node
// bench: task 3 — numeric summary stats with mechanical contract.
// Candidate: a single dependency-free Node file `stats.mjs` reading numeric
// lines from stdin and printing one JSON object:
//   {"count":N,"sum":S,"mean":M,"median":D,"min":Lo,"max":Hi}
// Rules: skip blank lines; numbers may have decimals; empty input must print
// exactly {"count":0}; mean/median are compared with 1e-6 tolerance.
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const FIXTURES = [
  ['1\n2\n3\n4\n5\n', { count: 5, sum: 15, mean: 3, median: 3, min: 1, max: 5 }],
  ['', { count: 0 }],
  ['10\n-5\n0\n', { count: 3, sum: 5, mean: 5 / 3, median: 0, min: -5, max: 10 }],
  ['3\n1\n2\n', { count: 3, sum: 6, mean: 2, median: 2, min: 1, max: 3 }],
  ['1.5\n2.5\n', { count: 2, sum: 4, mean: 2, median: 2, min: 1.5, max: 2.5 }],
  ['7\n7\n7\n', { count: 3, sum: 21, mean: 7, median: 7, min: 7, max: 7 }],
]

const approxEq = (got, want) => Math.abs(got - want) <= 1e-6
const keysOf = (want) => Object.keys(want).sort()

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'stats.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'stats.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  let ok = 0
  for (const [input, want] of FIXTURES) {
    const r = spawnSync(runner, ['stats.mjs'], { cwd: dir, input, encoding: 'utf-8', timeout: 5000 })
    let got = null
    try { got = JSON.parse((r.stdout ?? '').trim()) } catch { /* not json */ }
    const pass = r.status === 0 && got !== null
      && keysOf(want).every((k) => k in got && approxEq(got[k], want[k]))
      && Object.keys(got).length === keysOf(want).length
    if (pass) ok++
    checks.push({ name: `fixture ${JSON.stringify(input.slice(0, 10))}...`, pass, got: pass ? 'ok' : `exit=${r.status} got=${(r.stdout ?? '').trim().slice(0, 60)}` })
  }
  return { score: ok, max: FIXTURES.length, checks }
}