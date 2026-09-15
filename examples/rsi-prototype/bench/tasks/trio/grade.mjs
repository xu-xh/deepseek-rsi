#!/usr/bin/env node
// bench: task 4 — cross-file consistency trio with mechanical contract.
// Candidate delivers three dependency-free Node/bare files:
//   config.json  — a flat JSON object of string pairs, e.g. {"k1":"v1","k2":"v2"}
//   reader.mjs   — reads config.json, prints one line: CONFIG-OK: k1=v1,k2=v2
//                  (keys sorted, comma-separated, values verbatim)
//   checker.mjs  — reads config.json, verifies the reader would reference every
//                  key: prints OK and exits 0 when consistent, else prints
//                  MISSING: <keys> and exits 1.
// The grader overwrites config.json with fresh fixtures BEFORE each probe, so
// hard-coding the initial config (the classic single-shot mistake) fails.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const FIXTURES = [
  { k1: 'v1', k2: 'v2' },
  { alpha: '1', beta: '2', gamma: '3' },
  { x: '', z: 'with space', y: 'a=b' },
]

const expected = (cfg) => 'CONFIG-OK: ' + Object.keys(cfg).sort().map((k) => `${k}=${cfg[k]}`).join(',') + '\n'

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const files = await fs.readdir(dir).catch(() => [])
  for (const f of ['config.json', 'reader.mjs', 'checker.mjs']) {
    checks.push({ name: `${f} present`, pass: files.includes(f), got: files.join(',') })
  }
  if (!['config.json', 'reader.mjs', 'checker.mjs'].every((f) => files.includes(f))) {
    return { score: checks.filter((c) => c.pass).length, max: checks.length, checks }
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-trio-'))
  let ok = 0
  try {
    for (const f of ['reader.mjs', 'checker.mjs']) await fs.copyFile(path.join(dir, f), path.join(tmp, f))
    for (const cfg of FIXTURES) {
      await fs.writeFile(path.join(tmp, 'config.json'), JSON.stringify(cfg))
      const r = spawnSync(runner, ['reader.mjs'], { cwd: tmp, encoding: 'utf-8', timeout: 5000 })
      const passRead = r.status === 0 && r.stdout === expected(cfg)
      if (passRead) ok++
      checks.push({ name: `reader resolves fixture ${JSON.stringify(cfg).slice(0, 24)}`, pass: passRead, got: JSON.stringify((r.stdout ?? '').trim()).slice(0, 70) })
      const c = spawnSync(runner, ['checker.mjs'], { cwd: tmp, encoding: 'utf-8', timeout: 5000 })
      const passCheck = c.status === 0 && /^OK\b/.test((c.stdout ?? '').trim())
      if (passCheck) ok++
      checks.push({ name: `checker consistent on fixture ${JSON.stringify(cfg).slice(0, 24)}`, pass: passCheck, got: `exit=${c.status} ${JSON.stringify((c.stdout ?? '').trim()).slice(0, 50)}` })
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
  return { score: ok, max: FIXTURES.length * 2, checks }
}