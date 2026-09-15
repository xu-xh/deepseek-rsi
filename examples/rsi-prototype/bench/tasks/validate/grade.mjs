#!/usr/bin/env node
// bench: task 5 — a strict validator with hostile encoding edges.
// Candidate: one dependency-free Node file `validate.mjs` reading lines from
// stdin. Each line should match ^[A-Z]{2}[0-9]{4}$ (e.g. AB1234).
// Output: per line `OK` or `BAD <line>`; after all lines, one summary
// `N ok, M bad` (N/M being the counts of OK/BAD lines).
// Input may be Windows CRLF text, may start with a UTF-8 BOM, and may end with
// a trailing blank line — none of these may turn a valid code into BAD.
// Single-shot agents commonly forget to strip \r (the regex $ anchor then
// rejects AB1234\r) or count the BOM as a character; each fixture below is a
// deliberate trap for those mistakes.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const FIXTURES = [
  'AB1234\nCD9876\n',
  'AB1234\r\nCD9876\r\n',                       // CRLF endings
  '\uFEFFAB1234\r\nEF0001\r\n',                 // BOM + CRLF
  'AB1234\nbadline\nXY0000\n\n',                // one bad line + trailing blank
  'ZZ9999\r\nAB1234\r\n',                       // CRLF again, reversed order
  'AA0000\nBB1111\nCC2222\nDD3333\nEE4444\n',   // five valid
]

const want = (input) => {
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/)
  const body = lines.filter((l) => l.trim() !== '')
  let n = 0
  let m = 0
  const out = []
  for (const l of body) {
    if (/^[A-Z]{2}[0-9]{4}$/.test(l)) { n++; out.push('OK') } else { m++; out.push('BAD ' + l) }
  }
  return out.join('\n') + `\n${n} ok, ${m} bad\n`
}

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'validate.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'validate.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  let ok = 0
  for (const fx of FIXTURES) {
    const r = spawnSync(runner, ['validate.mjs'], { cwd: dir, input: fx, encoding: 'utf-8', timeout: 5000 })
    const got = (r.stdout ?? '')
    const pass = r.status === 0 && got === want(fx)
    if (pass) ok++
    checks.push({ name: `fixture ${JSON.stringify(fx.slice(0, 14))}...`, pass, got: pass ? 'ok' : `exit=${r.status} got=${JSON.stringify(got.trim().slice(0, 50))}` })
  }
  return { score: ok, max: FIXTURES.length, checks }
}