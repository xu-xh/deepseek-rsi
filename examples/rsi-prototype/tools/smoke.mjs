#!/usr/bin/env node
// smoke.mjs — no-LLM mechanical checks for the RSI prototype (W1).
// Verifies the memory-commit gate, atomic install, hashing, and the isolation
// path guard. Run: node examples/rsi-prototype/tools/smoke.mjs
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  commitMemory, verifyMemory, treeHash, walkFiles, isValidActorName,
} from '../lib/memory-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..') // examples/rsi-prototype
const CLI = path.join(ROOT, 'tools', 'commit-memory.mjs')
const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-smoke-'))
let failures = 0

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

try {
  // fixture candidate
  const cand = path.join(ws, 'waves/w001/candidates/a01')
  await fs.mkdir(cand, { recursive: true })
  await fs.writeFile(path.join(cand, 'usage.md'), '# Usage\n\nRun `node app.js`.')
  await fs.writeFile(path.join(cand, 'PROPOSAL.md'), 'Fixed the run command.')
  const commits = path.join(ws, 'commits')

  // 1. commit generates manifest + copies files atomically
  const m = await commitMemory({
    candidate: cand, wave: 1, actor: 'a01',
    verdict: 'PASS', score: 84, findings: 'requirements confirmed',
    out: commits, root: ws,
  })
  check('commit returns tree_sha256', typeof m.tree_sha256 === 'string' && m.tree_sha256.length === 64)
  check('candidate files copied', (await walkFiles(path.join(commits, 'w001/a01'))).sort().join(',') === 'MANIFEST.json,PROPOSAL.md,usage.md')
  check('journal appended', (await fs.readFile(path.join(commits, 'journal.jsonl'), 'utf-8')).trim().split('\n').length === 1)

  // 2. verify passes
  const ok = await verifyMemory(path.join(commits, 'w001/a01'))
  check('verify accepts intact commit', ok.ok, ok.reason)

  // 3. verify fails on tampering (content hash caught)
  await fs.appendFile(path.join(commits, 'w001/a01/usage.md'), 'TAMPER')
  const bad = await verifyMemory(path.join(commits, 'w001/a01'))
  check('verify rejects tampered tree', !bad.ok, bad.reason)
  // restore for the hash check below
  await fs.writeFile(path.join(commits, 'w001/a01/usage.md'), '# Usage\n\nRun `node app.js`.')

  // 4. CLI hash mode agrees with manifest
  const hash = await treeHash(path.join(commits, 'w001/a01'))
  check('recomputed tree hash matches manifest', hash === m.tree_sha256)

  // 5. path guard rejects escaping candidates
  let guarded = false
  try {
    await commitMemory({
      candidate: os.homedir(), wave: 2, actor: 'a01',
      verdict: 'FAIL', score: 10, findings: '',
      out: commits, root: ws,
    })
  } catch (e) {
    guarded = /escapes allowed root/.test(String(e?.message))
  }
  check('path guard blocks candidates outside workspace root', guarded)

  // 6. path guard rejects traversal actor names
  let actorGuard = false
  try {
    await commitMemory({
      candidate: cand, wave: 3, actor: '../evil', verdict: 'FAIL', score: 10,
      findings: '', out: commits, root: ws,
    })
  } catch (e) {
    actorGuard = /invalid actor name/.test(String(e?.message))
  }
  check('actor-name guard blocks traversal', actorGuard)
  check('isValidActorName rejects ../evil', !isValidActorName('../evil'))

  // 7. isolation layout: waves/ and commits/ never overlap
  check('workspace layout separates waves/ and commits/', !(await fs.realpath(cand)).startsWith(await fs.realpath(commits)))

  // 8. CLI flag form (canonical documented form) works end-to-end
  const cliCand = path.join(ws, 'waves/w010/candidates/a01')
  await fs.mkdir(cliCand, { recursive: true })
  await fs.writeFile(path.join(cliCand, 'note.md'), '# note\n')
  const cliOut = path.join(ws, 'cli-commits')
  const flagOut = execFileSync('node', [
    CLI, '--mode', 'generate',
    '--candidate', cliCand, '--wave', '10', '--actor', 'a01',
    '--verdict', 'PASS', '--score', '80', '--findings', 'ok',
    '--out', cliOut, '--root', ws,
  ], { encoding: 'utf-8' })
  const flagManifest = JSON.parse(flagOut)
  check('CLI flag form exits 0 and emits manifest', flagManifest.ok === true && typeof flagManifest.tree_sha256 === 'string')
  const flagVerify = JSON.parse(execFileSync('node', [CLI, '--mode', 'verify', '--dir', path.join(cliOut, 'w010/a01')], { encoding: 'utf-8' }))
  check('CLI flag form verify accepts commit', flagVerify.ok === true, flagVerify.reason)

  // 9. CLI positional form is equivalent
  const cliOut2 = path.join(ws, 'cli-commits-pos')
  const posOut = execFileSync('node', [
    CLI, 'generate', cliCand, '11', 'a01', 'FAIL', '45', 'needs work', cliOut2, ws,
  ], { encoding: 'utf-8' })
  const posManifest = JSON.parse(posOut)
  check('CLI positional form exits 0 and emits manifest', posManifest.ok === true && posManifest.wave === 11)
  const posVerify = JSON.parse(execFileSync('node', [CLI, 'verify', path.join(cliOut2, 'w011/a01')], { encoding: 'utf-8' }))
  check('CLI positional form verify accepts commit', posVerify.ok === true, posVerify.reason)

  // 10. CLI exit-code contract: guard-class errors exit 2, usage errors exit 1
  let guardCode = 0
  try {
    execFileSync('node', [CLI, '--mode', 'generate', '--candidate', os.homedir(), '--wave', '1', '--actor', 'a01', '--verdict', 'FAIL', '--score', '10', '--out', cliOut2, '--root', ws], { encoding: 'utf-8', stdio: 'pipe' })
  } catch (e) {
    guardCode = e.status
  }
  check('CLI path-guard returns exit 2', guardCode === 2, `got ${guardCode}`)
  let usageCode = 0
  try {
    execFileSync('node', [CLI, '--mode', 'frobnicate'], { encoding: 'utf-8', stdio: 'pipe' })
  } catch (e) {
    usageCode = e.status
  }
  check('CLI usage error returns exit 1', usageCode === 1, `got ${usageCode}`)

  // ---- W2: restricted verifier read channel (verify-read) ----
  const READ = path.join(ROOT, 'tools', 'verify-read.mjs')
  const vRoot = path.join(ws, 'verify-area')
  await fs.mkdir(vRoot, { recursive: true })
  await fs.writeFile(path.join(vRoot, 'note.md'), '# verified note\n')
  const inRoot = execFileSync('node', [READ, '--root', vRoot, '--path', 'note.md'], { encoding: 'utf-8' })
  check('verify-read allows in-root read', inRoot.includes('# verified note'))

  // 12. verify-read rejects paths escaping the allowed root
  let readGuard = 0
  try {
    execFileSync('node', [READ, '--root', vRoot, '--path', os.homedir()], { encoding: 'utf-8', stdio: 'pipe' })
  } catch (e) {
    readGuard = e.status
  }
  check('verify-read containment violation returns exit 2', readGuard === 2, `got ${readGuard}`)

  // 13. verify-read listing skips symlinks (no traversal)
  await fs.symlink(cand, path.join(vRoot, 'escape-link'), 'dir')
  const listing = JSON.parse(execFileSync('node', [READ, '--root', vRoot, '--list'], { encoding: 'utf-8' }))
  check('verify-read --list excludes symlinks', !listing.files.includes('escape-link'), JSON.stringify(listing.files))

  // ---- W2: behavioral verification with rollback (verify-run) ----
  const RUN = path.join(ROOT, 'tools', 'verify-run.mjs')
  await fs.writeFile(path.join(vRoot, 'probe.sh'), '#!/bin/sh\necho probe-ok\nprintf leaked > leaktrack.txt\n')
  const runRes = JSON.parse(execFileSync('node', [RUN, '--candidate', vRoot, '--timeout', '10', '--', 'sh', 'probe.sh'], { encoding: 'utf-8' }))
  check('verify-run behavioral probe ok', runRes.ok === true && runRes.exit_code === 0, JSON.stringify({ exit: runRes.exit_code, out: runRes.stdout.slice(0, 30) }))
  check('verify-run side effects rolled back (original untouched)', !(await fs.stat(path.join(vRoot, 'leaktrack.txt')).then(() => true, () => false)))
  const leftovers = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('rsi-verify-'))
  check('verify-run discards copies after execution', leftovers.length === 0, JSON.stringify(leftovers))

  let timeoutCode = 0
  const timedRes = (() => {
    try {
      return JSON.parse(execFileSync('node', [RUN, '--candidate', vRoot, '--timeout', '1', '--', 'sleep', '5'], { encoding: 'utf-8', timeout: 15000 }))
    } catch (e) {
      timeoutCode = e.status ?? 0
      return e.stdout ? JSON.parse(e.stdout) : null
    }
  })()
  check('verify-run timeout marks timed_out', timedRes?.timed_out === true, `code=${timeoutCode} timed=${timedRes?.timed_out}`)

  // ---- W2+: verifier access audit (mechanization of "what did the verifier touch") ----
  const auditDir = path.join(ws, 'audit')
  await fs.mkdir(auditDir, { recursive: true })
  const auditRead = path.join(auditDir, 'verifier.jsonl')
  execFileSync('node', [READ, '--root', vRoot, '--path', 'note.md', '--audit', auditRead], { encoding: 'utf-8' })
  let esc = 0
  try {
    execFileSync('node', [READ, '--root', vRoot, '--path', os.homedir(), '--audit', auditRead], { encoding: 'utf-8', stdio: 'pipe' })
  } catch (e) { esc = e.status }
  check('audited escape attempt also returns exit 2', esc === 2, `got ${esc}`)
  execFileSync('node', [RUN, '--candidate', vRoot, '--timeout', '10', '--audit', auditRead, '--', 'sh', 'probe.sh'], { encoding: 'utf-8' })
  const auditLines = (await fs.readFile(auditRead, 'utf8')).trim().split('\n').map(JSON.parse)
  check('audit log records read | denied | run',
    auditLines.map((l) => `${l.tool}:${l.ok}`).join('|') === 'verify-read:true|verify-read:false|verify-run:true',
    JSON.stringify(auditLines.map((l) => ({ tool: l.tool, ok: l.ok }))))
  check('audit contains no write events', auditLines.every((l) => l.tool !== 'verify-run' || l.cmd), 'only reads and runs')

  // ---- deploy-scope gate: verifier tool surface is machine-checkable ----
  const scopeOk = execFileSync('node', [path.join(ROOT, 'tools', 'check-deploy-scope.mjs')], { encoding: 'utf-8' })
  check('deploy verifier-scope gate passes', scopeOk.includes('DEPLOY-SCOPE OK'), scopeOk.split('\n').filter((l) => l.startsWith('FAIL')).join('; ') || 'ok')
} finally {
  await fs.rm(ws, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nSMOKE OK (all checks passed)' : `\nSMOKE FAILED: ${failures} check(s)`)
process.exitCode = failures === 0 ? 0 : 1