#!/usr/bin/env node
// bench: task 6 — data-flow chain with upstream mutation probes.
// Candidate delivers three dependency-free Node files:
//   a.mjs — prints exactly one line `A:OK-v1`
//   b.mjs — runs `node a.mjs`, prints `B:OK: <a's first line>`
//   c.mjs — runs `node b.mjs`, prints `C:OK: <b's output line without trailing \n>`
// The grader runs the real chain, then REPLACES a.mjs with mutated upstreams and
// asserts c.mjs still carries the mutated token through — hard-coded chain
// text (never actually running the upstream) fails these probes.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const MUTATIONS = [
  "console.log('A:OK-MUT1-v7')\n",
  "console.log('A:OK-mut2 with space')\n",
  "console.log('A:OK-\\u4e2d\\u6587-xyz')\n",
]

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const files = await fs.readdir(dir).catch(() => [])
  for (const f of ['a.mjs', 'b.mjs', 'c.mjs']) {
    checks.push({ name: `${f} present`, pass: files.includes(f), got: files.join(',') })
  }
  if (!['a.mjs', 'b.mjs', 'c.mjs'].every((f) => files.includes(f))) {
    return { score: checks.filter((c) => c.pass).length, max: checks.length, checks }
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-chain-'))
  let ok = 0
  try {
    for (const f of ['a.mjs', 'b.mjs', 'c.mjs']) await fs.copyFile(path.join(dir, f), path.join(tmp, f))
    const direct = spawnSync(runner, ['a.mjs'], { cwd: tmp, encoding: 'utf-8', timeout: 5000 })
    const directOk = direct.status === 0 && /^A:OK-/.test((direct.stdout ?? '').trim())
    if (directOk) ok++
    checks.push({ name: 'a.mjs runs and prints A:OK-*', pass: directOk, got: JSON.stringify((direct.stdout ?? '').trim()).slice(0, 40) })

    const chain = spawnSync(runner, ['c.mjs'], { cwd: tmp, encoding: 'utf-8', timeout: 5000 })
    const chainOk = chain.status === 0 && /^C:OK: B:OK: A:OK-v1$/.test((chain.stdout ?? '').trim())
    if (chainOk) ok++
    checks.push({ name: 'default chain carries A:OK-v1 end to end', pass: chainOk, got: JSON.stringify((chain.stdout ?? '').trim()).slice(0, 60) })

    for (const [i, mut] of MUTATIONS.entries()) {
      await fs.writeFile(path.join(tmp, 'a.mjs'), mut)
      const r = spawnSync(runner, ['c.mjs'], { cwd: tmp, encoding: 'utf-8', timeout: 5000 })
      const want = mut.includes('console.log') ? `C:OK: B:OK: ${mut.trim().replace(/^console\.log\('|'\)$/g, '')}` : null
      let pass = false
      if (want && r.status === 0) {
        const got = (r.stdout ?? '').trim()
        pass = got === want
      }
      const passFinal = pass || (r.status === 0 && /^C:OK: B:OK: A:OK-/.test((r.stdout ?? '').trim()) && !/A:OK-v1$/.test((r.stdout ?? '').trim()))
      if (passFinal) ok++
      checks.push({ name: `mutation ${i + 1} propagates through real chain`, pass: passFinal, got: JSON.stringify((r.stdout ?? '').trim()).slice(0, 60) })
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
  return { score: ok, max: 2 + MUTATIONS.length, checks }
}