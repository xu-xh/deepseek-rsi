#!/usr/bin/env node
// bench: natural-defect task 4 — an archiver must never overwrite a previous archive.
// Origin: real defect found in the run loop — re-running with the same wave/actor
// ids overwrote an existing memory commit, mixing old and new files until the
// immutability guard was added. Candidate must implement write-once semantics.
// Candidate: one dependency-free Node file `archive.mjs <dir>` that copies every
// file from <dir> into a NEW unique subdir of ./out (never reusing an existing
// name), or if it would collide with an existing archive prints `EXISTS` exit 3
// WITHOUT modifying anything. On first success prints `ARCHIVED <name>`.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'archive.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'archive.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-archive-'))
  let ok = src ? 1 : 0 // presence counts
  try {
    const payload = path.join(tmp, 'payload')
    const out = path.join(tmp, 'out')
    await fs.mkdir(payload, { recursive: true })
    await fs.writeFile(path.join(payload, 'data.txt'), 'v1-content')

    const run1 = spawnSync(runner, ['archive.mjs', payload], { cwd: dir, encoding: 'utf-8', timeout: 5000, env: { ...process.env, ARCHIVE_OUT: out } })
    const ok1 = run1.status === 0 && /^ARCHIVED\s+\S+/.test((run1.stdout ?? '').trim())
    if (ok1) ok++
    checks.push({ name: 'first archive succeeds', pass: ok1, got: `exit=${run1.status} ${JSON.stringify((run1.stdout ?? '').trim()).slice(0, 60)}` })

    // Second run must refuse (EXISTS, exit 3) and leave the first archive intact.
    const run2 = spawnSync(runner, ['archive.mjs', payload], { cwd: dir, encoding: 'utf-8', timeout: 5000, env: { ...process.env, ARCHIVE_OUT: out } })
    const ok2 = run2.status !== 0 && /EXISTS/.test((run2.stdout ?? '').trim() + (run2.stderr ?? ''))
    if (ok2) ok++
    checks.push({ name: 'second archive refused with EXISTS', pass: ok2, got: `exit=${run2.status} ${JSON.stringify(((run2.stdout ?? '') + (run2.stderr ?? '')).trim()).slice(0, 60)}` })

    // First archive's payload unchanged and still readable.
    const files = await fs.readdir(out).catch(() => [])
    let intact = false
    for (const f of files) {
      const p = path.join(out, f, 'data.txt')
      if (await fs.readFile(p, 'utf8').then((t) => t === 'v1-content', () => false)) { intact = true; break }
    }
    if (intact) ok++
    checks.push({ name: 'first archive payload intact after refusal', pass: intact, got: files.join(',') })
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
  return { score: ok, max: 4, checks }
}