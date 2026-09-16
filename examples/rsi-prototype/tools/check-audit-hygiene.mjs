#!/usr/bin/env node
// check-audit-hygiene.mjs — acceptance tests for T2: verifier tools must not
// create audit files when --audit is absent. PUBLIC: candidates may read it.
//
// Bug under test (real defect found during T1 eval): verify-read/verify-run
// computed `auditFile = argv[argv.indexOf('--audit') + 1]`; without --audit
// that is argv[0] (the literal string "--root" / "--candidate"), which is
// truthy, so every run appended an audit JSONL to a CWD file named "--root"
// or "--candidate" — a hidden side effect on a bare run.
//
// Contract:
//   - verify-read / verify-run WITHOUT --audit must create NO new files in
//     the CWD (zero file side effects) and keep their normal stdout/exit.
//   - WITH --audit <file> they keep appending JSONL exactly as before
//     (verify-read: {tool:'verify-read', ..., ok}; verify-run: {tool:'verify-run', ..., cmd}).
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const READ = path.join(HERE, 'verify-read.mjs')
const RUN = path.join(HERE, 'verify-run.mjs')

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}
const cleanRun = (exe, argv, cwd) => spawnSync(process.execPath, [exe, ...argv], { encoding: 'utf-8', timeout: 15000, cwd })

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-audit-'))
try {
  const work = path.join(tmp, 'work')
  await fs.mkdir(path.join(work, 'root'), { recursive: true })
  await fs.writeFile(path.join(work, 'root', 'note.md'), '# audited note\n')

  // 1. verify-read without --audit: no new files in CWD, normal output
  const before = await fs.readdir(work)
  const r1 = cleanRun(READ, ['--root', path.join(work, 'root'), '--path', 'note.md'], work)
  const after = await fs.readdir(work)
  const newFiles = after.filter((f) => !before.includes(f))
  check('verify-read without --audit creates no files', newFiles.length === 0, JSON.stringify(newFiles))
  check('verify-read without --audit still outputs content', r1.status === 0 && (r1.stdout ?? '').includes('# audited note'), `exit=${r1.status} out=${JSON.stringify((r1.stdout ?? '').slice(0, 40))}`)

  // 2. verify-run without --audit: no new files, normal result
  const before2 = await fs.readdir(work)
  await fs.writeFile(path.join(work, 'root', 'probe.sh'), '#!/bin/sh\necho probe-t2-ok\n')
  const r2 = cleanRun(RUN, ['--candidate', path.join(work, 'root'), '--timeout', '10', '--', 'sh', 'probe.sh'], work)
  const after2 = await fs.readdir(work)
  const newFiles2 = after2.filter((f) => !before2.includes(f))
  check('verify-run without --audit creates no files', newFiles2.length === 0, JSON.stringify(newFiles2))
  check('verify-run without --audit still runs', r2.status === 0 && (r2.stdout ?? '').includes('probe-t2-ok'), `exit=${r2.status} out=${JSON.stringify((r2.stdout ?? '').slice(0, 60))}`)

  // 3. direct regression probe: literal --root / --candidate named files must never appear
  const dirty = after.filter((f) => f === '--root' || f === '--candidate')
    .concat(after2.filter((f) => f === '--root' || f === '--candidate'))
  check('no literal --root/--candidate audit files in CWD', dirty.length === 0, JSON.stringify(dirty))

  // 4. WITH --audit: appends JSONL as before, both tools
  const auditRead = path.join(work, 'audit-read.jsonl')
  const r3 = cleanRun(READ, ['--root', path.join(work, 'root'), '--path', 'note.md', '--audit', auditRead], work)
  const auditRun = path.join(work, 'audit-run.jsonl')
  const r4 = cleanRun(RUN, ['--candidate', path.join(work, 'root'), '--timeout', '10', '--audit', auditRun, '--', 'sh', 'probe.sh'], work)
  const readLines = (await fs.readFile(auditRead, 'utf8')).trim().split('\n').map(JSON.parse)
  check('verify-read --audit appends one JSONL row', readLines.length === 1 && readLines[0].tool === 'verify-read' && readLines[0].ok === true, JSON.stringify(readLines.slice(-1)[0] ?? null))
  const runLines = (await fs.readFile(auditRun, 'utf8')).trim().split('\n').map(JSON.parse)
  check('verify-run --audit appends one JSONL row', runLines.length === 1 && runLines[0].tool === 'verify-run' && typeof runLines[0].cmd === 'string', JSON.stringify(runLines.slice(-1)[0] ?? null))
  check('audited runs still succeed', r3.status === 0 && r4.status === 0, `read=${r3.status} run=${r4.status}`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nCHECK-AUDIT-HYGIENE OK' : `\nCHECK-AUDIT-HYGIENE FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1