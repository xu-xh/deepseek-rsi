#!/usr/bin/env node
// check-commit-list.mjs — acceptance tests for the commit-memory `--mode list`
// audit subcommand (task T1 of the DSH-real-dev evaluation). PUBLIC: like any
// real repository test, candidates may read and run it.
//
// Contract under test (tools/commit-memory.mjs --mode list):
//   node tools/commit-memory.mjs --mode list --out <commitsRoot>
//     - walks <commitsRoot>/<actor>/<dir>/ for dirs containing MANIFEST.json
//     - sorts rows by (actor asc, wave asc)
//     - prints one row per commit: `w<wave3> <actor> <commitDir> <tree12>`
//       where wave3 = zero-padded to 3 digits, tree12 = first 12 chars of the
//       manifest tree_sha256
//     - --json adds a JSON array [{wave, actor, commit, hash}] to stdout
//       (wave as a number, no other output)
//     - empty tree, non-json: no stdout, exit 0; json: `[]`, exit 0
//     - missing --out: usage error to stderr, exit 1
//     - must not change generate/verify/hash behavior (smoke regression gate)
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, 'commit-memory.mjs')

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

async function makeCommit(root, { actor, wave, hash }) {
  const dir = path.join(root, actor, `w${String(wave).padStart(3, '0')}`)
  await fs.mkdir(dir, { recursive: true })
  const manifest = { format: 1, wave, tree_sha256: hash, files: { 'note.md': 'x' } }
  await fs.writeFile(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest) + '\n')
  await fs.writeFile(path.join(dir, 'note.md'), `note w${wave} ${actor}\n`)
}

const run = (argv, env) => spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf-8', timeout: 10000, env: env ?? process.env })

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-list-'))
try {
  // fixture: committer order deliberately differs from (actor, wave) order
  const root = path.join(tmp, 'commits')
  await fs.mkdir(path.join(root, 'empty'), { recursive: true }) // acts as a stray dir
  await makeCommit(root, { actor: 'b1', wave: 2, hash: 'b'.repeat(64) })
  await makeCommit(root, { actor: 'a1', wave: 3, hash: 'c'.repeat(64) })
  await makeCommit(root, { actor: 'c1', wave: 1, hash: 'a'.repeat(64) })
  await makeCommit(root, { actor: 'a1', wave: 1, hash: 'd'.repeat(64) })
  await fs.writeFile(path.join(root, 'not-a-commit.md'), 'stray file\n')

  // 1. non-json full listing: exact rows, sorted, exit 0
  const all = run(['--mode', 'list', '--out', root])
  check('list exits 0', all.status === 0, `exit=${all.status}`)
  const lines = (all.stdout ?? '').trim().split('\n').filter(Boolean)
  check('list row count = 4', lines.length === 4, JSON.stringify(lines))
  const want = [
    'w001 a1 w001 dddddddddddd',
    'w003 a1 w003 cccccccccccc',
    'w002 b1 w002 bbbbbbbbbbbb',
    'w001 c1 w001 aaaaaaaaaaaa',
  ]
  check('list rows exact (sorted, padded, tree12)', JSON.stringify(lines) === JSON.stringify(want), JSON.stringify(lines))

  // 2. json listing: array, numeric wave, same order
  const js = run(['--mode', 'list', '--out', root, '--json'])
  check('list --json exits 0', js.status === 0, `exit=${js.status}`)
  let parsed = null
  try { parsed = JSON.parse(js.stdout) } catch { parsed = null }
  check('list --json parses', Array.isArray(parsed) && parsed.length === 4, JSON.stringify((js.stdout ?? '').slice(0, 80)))
  const wantJson = [
    { wave: 1, actor: 'a1', commit: 'w001', hash: 'd'.repeat(12) },
    { wave: 3, actor: 'a1', commit: 'w003', hash: 'c'.repeat(12) },
    { wave: 2, actor: 'b1', commit: 'w002', hash: 'b'.repeat(12) },
    { wave: 1, actor: 'c1', commit: 'w001', hash: 'a'.repeat(12) },
  ]
  check('list --json rows exact', JSON.stringify(parsed) === JSON.stringify(wantJson), JSON.stringify(parsed))

  // 3. empty tree: no output / [] with exit 0
  const emptyRoot = path.join(tmp, 'empty-commits')
  await fs.mkdir(emptyRoot, { recursive: true })
  const e1 = run(['--mode', 'list', '--out', emptyRoot])
  check('empty list: no stdout, exit 0', e1.status === 0 && (e1.stdout ?? '').trim() === '', `exit=${e1.status} out=${JSON.stringify(e1.stdout)}`)
  const e2 = run(['--mode', 'list', '--out', emptyRoot, '--json'])
  check('empty list --json: []', e2.status === 0 && (e2.stdout ?? '').trim() === '[]', `exit=${e2.status} out=${JSON.stringify(e2.stdout)}`)

  // 4. missing --out: usage error, exit 1
  const noOut = run(['--mode', 'list'])
  check('list without --out: exit 1 + stderr', noOut.status === 1 && /--out|usage/i.test(noOut.stderr ?? ''), `exit=${noOut.status} err=${JSON.stringify((noOut.stderr ?? '').slice(0, 60))}`)

  // 5. regression: generate/verify/hash still behave (implicitly covered by smoke; one spot check here)
  const spot = run(['--mode', 'hash', '--dir', path.join(root, 'a1', 'w001')])
  check('hash mode regression ok', spot.status === 0 && /tree_sha256/.test(spot.stdout ?? ''), `exit=${spot.status}`)
} finally {
  await fs.rm(tmp, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nCHECK-COMMIT-LIST OK' : `\nCHECK-COMMIT-LIST FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1