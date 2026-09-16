#!/usr/bin/env node
// bench: natural-defect task 3 — config-path resolution must survive a missing HOME.
// Origin: real defect found in run-1 — subprocesses inherited no $HOME in the
// harness, so any tool that assumed $HOME blew up until env was fixed.
// Candidate: one dependency-free Node file `paths.mjs` printing one line
// `CFG=<path>` with the FIRST existing source, in priority order:
//   1. $CFG_DIR (explicit env)      2. $HOME/.rsi-cfg      3. os.tmpdir()/rsi-cfg
// The grader runs it under three environments: CFG_DIR only, HOME only, and
// with both HOME and CFG_DIR removed (must still print a usable path — a crash
// or empty output fails).
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const mkCfg = async (p) => { await fs.mkdir(p, { recursive: true }) }

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'paths.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'paths.mjs exists', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-home-'))
  let ok = src ? 1 : 0 // presence counts
  try {
    const cfgDir = path.join(tmp, 'cfgdir')
    const homeDir = path.join(tmp, 'home')
    await mkCfg(cfgDir)
    await mkCfg(path.join(homeDir, '.rsi-cfg'))

    // 1. CFG_DIR wins even when HOME is also set
    let r = spawnSync(runner, ['paths.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 5000, env: { ...process.env, CFG_DIR: cfgDir, HOME: homeDir } })
    let pass = r.status === 0 && /^CFG=/.test((r.stdout ?? '').trim()) && (r.stdout ?? '').includes(cfgDir)
    if (pass) ok++
    checks.push({ name: 'CFG_DIR preferred over HOME', pass, got: JSON.stringify((r.stdout ?? '').trim()) })

    // 2. HOME/.rsi-cfg used when CFG_DIR unset
    r = spawnSync(runner, ['paths.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 5000, env: { ...process.env, CFG_DIR: '', HOME: homeDir } })
    pass = r.status === 0 && /^CFG=/.test((r.stdout ?? '').trim()) && (r.stdout ?? '').includes(homeDir)
    if (pass) ok++
    checks.push({ name: 'HOME/.rsi-cfg used when CFG_DIR unset', pass, got: JSON.stringify((r.stdout ?? '').trim()) })

    // 3. neither HOME nor CFG_DIR — must still print a usable path (no crash)
    const bare = { ...process.env }; delete bare.HOME; delete bare.CFG_DIR
    r = spawnSync(runner, ['paths.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 5000, env: bare })
    pass = r.status === 0 && /^CFG=.+/.test((r.stdout ?? '').trim())
    if (pass) ok++
    checks.push({ name: 'survives missing HOME and CFG_DIR (fallback, no crash)', pass, got: `exit=${r.status} out=${JSON.stringify((r.stdout ?? '').trim()).slice(0, 60)} ${r.error ? 'TIMEOUT' : ''}` })
  } finally {
    await fs.rm(tmp, { recursive: true, force: true })
  }
  return { score: ok, max: 4, checks }
}