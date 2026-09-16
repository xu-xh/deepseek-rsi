#!/usr/bin/env node
// bench: natural-defect task 1 — CLI must accept BOTH flag and positional forms.
// Origin: real defect in commit-memory.mjs (run-1) — the committer agent invoked
// `--mode generate` (flag form) but the CLI only parsed a positional, so every
// commit silently failed until the CLI was fixed to accept both.
// Candidate: one dependency-free Node file `cli.mjs`:
//   flag form:  node cli.mjs --mode generate --name X   -> prints `MODE=generate NAME=X`
//   flag=val:   node cli.mjs --mode=generate --name=X   -> same
//   positional: node cli.mjs generate X                 -> same
//   missing args -> exit 2 with a usage line on stderr, no stdout.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PROBES = [
  [['--mode', 'generate', '--name', 'X1'], 'MODE=generate NAME=X1', 0],
  [['--mode=generate', '--name=X2'], 'MODE=generate NAME=X2', 0],
  [['run', 'Y3'], 'MODE=run NAME=Y3', 0],
  [['--mode', 'generate'], null, 2], // missing --name
  [['generate'], null, 2],           // missing name
]

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'cli.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'cli.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  let ok = src ? 1 : 0 // presence counts
  for (const [argv, wantOut, wantCode] of PROBES) {
    const r = spawnSync(runner, ['cli.mjs', ...argv], { cwd: dir, encoding: 'utf-8', timeout: 5000 })
    let pass
    if (wantOut === null) {
      pass = r.status === wantCode && (r.stdout ?? '') === ''
    } else {
      pass = r.status === 0 && (r.stdout ?? '').trimEnd() === wantOut
    }
    if (pass) ok++
    checks.push({ name: `probe ${JSON.stringify(argv)}`, pass, got: `exit=${r.status} out=${JSON.stringify((r.stdout ?? '').trim()).slice(0, 50)}` })
  }
  return { score: ok, max: PROBES.length + 1, checks }
}