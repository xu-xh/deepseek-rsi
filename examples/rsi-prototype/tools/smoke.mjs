#!/usr/bin/env node
// smoke.mjs — no-LLM mechanical checks for the RSI prototype (W1).
// Verifies the memory-commit gate, atomic install, hashing, and the isolation
// path guard. Run: node examples/rsi-prototype/tools/smoke.mjs
import process from 'node:process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  commitMemory, verifyMemory, treeHash, walkFiles, isValidActorName,
} from '../lib/memory-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..') // examples/rsi-prototype
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
} finally {
  await fs.rm(ws, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nSMOKE OK (all checks passed)' : `\nSMOKE FAILED: ${failures} check(s)`)
process.exitCode = failures === 0 ? 0 : 1