#!/usr/bin/env node
// check-audit-workspace.mjs — acceptance tests for T3 (audit-workspace tool).
// PUBLIC: candidates may read and run it. Contract in docs/TASK-audit-workspace.md.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.join(HERE, 'audit-workspace.mjs')

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const run = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf-8', timeout: 10000 })
const manifest = (wave) => JSON.stringify({ format: 1, wave, tree_sha256: 'a'.repeat(64) })

async function mkCommit(root, wave, actor) {
  const w = `w${String(wave).padStart(3, '0')}`
  await fs.mkdir(path.join(root, w, actor), { recursive: true })
  await fs.writeFile(path.join(root, w, actor, 'MANIFEST.json'), manifest(wave))
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-aws-'))
try {
  const waves = path.join(tmp, 'waves')
  const commits = path.join(tmp, 'commits')
  // planned: w001/a01 (matched), w002/b01 (missing in commits), w006/a01 (manifest wave=5 mismatch)
  await fs.mkdir(path.join(waves, 'w001', 'a01'), { recursive: true })
  await fs.mkdir(path.join(waves, 'w002', 'b01'), { recursive: true })
  await fs.mkdir(path.join(waves, 'w006', 'a01'), { recursive: true })
  await fs.mkdir(path.join(commits, 'w001', 'a01'), { recursive: true })
  await fs.writeFile(path.join(commits, 'w001', 'a01', 'MANIFEST.json'), manifest(1))
  await fs.mkdir(path.join(commits, 'w006', 'a01'), { recursive: true })
  await fs.writeFile(path.join(commits, 'w006', 'a01', 'MANIFEST.json'), manifest(5))
  await fs.mkdir(path.join(commits, 'w003', 'c01'), { recursive: true }) // orphan
  await fs.writeFile(path.join(commits, 'w003', 'c01', 'MANIFEST.json'), manifest(3))
  // stray file in waves root must be a SKIP row, not a crash
  await fs.writeFile(path.join(waves, 'stray.txt'), 'x')

  // 1. plain output: OK line for matched
  const r1 = run(['--waves', waves, '--commits', commits])
  check('audit exits 1 when inconsistencies exist', r1.status === 1, `exit=${r1.status}`)
  const lines = (r1.stdout ?? '').trim().split('\n')
  check('OK row emitted for matched wave', lines.some((l) => l === 'OK w001 a01'), JSON.stringify(lines))
  check('MISSING row for uncommitted wave', lines.some((l) => l === 'MISSING w002 b01'), JSON.stringify(lines))
  check('WAVE-MISMATCH row with manifest wave', lines.some((l) => l === 'WAVE-MISMATCH w006 a01 5'), JSON.stringify(lines))
  check('ORPHAN row emitted (warning)', lines.some((l) => l === 'ORPHAN w003 c01'), JSON.stringify(lines))
  check('SKIP row for stray root entry', lines.some((l) => l.includes('SKIP') && l.includes('stray.txt')), JSON.stringify(lines))

  // 2. json output: array with kind/wave/actor
  const r2 = run(['--waves', waves, '--commits', commits, '--json'])
  let arr = null
  try { arr = JSON.parse(r2.stdout) } catch { arr = null }
  check('--json parses to array of rows', Array.isArray(arr) && arr.length >= 5, JSON.stringify((r2.stdout ?? '').slice(0, 80)))
  const miss = (arr ?? []).find((x) => x.kind === 'MISSING')
  check('--json MISSING row has wave+actor', miss && miss.wave === 2 && miss.actor === 'b01', JSON.stringify(miss))

  // 3. all-green fixture exits 0
  const w2 = path.join(tmp, 'waves2'); const c2 = path.join(tmp, 'commits2')
  await fs.mkdir(path.join(w2, 'w004', 'd01'), { recursive: true })
  await mkCommit(c2, 4, 'd01')
  await fs.mkdir(path.join(w2, 'w009', 'e01'), { recursive: true })
  await mkCommit(c2, 9, 'e01')
  const r3 = run(['--waves', w2, '--commits', c2])
  check('all-green audit exits 0', r3.status === 0, `exit=${r3.status} out=${JSON.stringify(r3.stdout)}`)
  const okLines = (r3.stdout ?? '').trim().split('\n')
  check('all-green emits OK rows sorted by wave', JSON.stringify(okLines) === JSON.stringify(['OK w004 d01', 'OK w009 e01']), JSON.stringify(okLines))

  // 4. usage error without required args
  const r4 = run(['--commits', commits])
  check('missing --waves exits 2 with usage', r4.status === 2 && /--waves/.test(r4.stderr ?? ''), `exit=${r4.status} ${JSON.stringify((r4.stderr ?? '').slice(0, 50))}`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nCHECK-AUDIT-WORKSPACE OK' : `\nCHECK-AUDIT-WORKSPACE FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1