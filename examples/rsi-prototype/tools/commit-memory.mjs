#!/usr/bin/env node
// commit-memory.mjs — CLI for the memory-commit gate (no dependencies).
//
// Usage (flag form — canonical):
//   node tools/commit-memory.mjs --mode generate \
//       --candidate <absCandDir> --wave <n> --actor <name> \
//       --verdict PASS|FAIL|UNVERIFIED --score <0-100> \
//       [--findings text] --out <absCommitsDir> --root <absAllowedRoot>
//   node tools/commit-memory.mjs --mode verify --dir <absCommittedDir>
//   node tools/commit-memory.mjs --mode hash --dir <absDir>
//
// Usage (positional form — equivalent):
//   node tools/commit-memory.mjs generate <absCandDir> <n> <name> \
//       <verdict> <score> [findings] <out> <root>
//   node tools/commit-memory.mjs verify <absDir>
//   node tools/commit-memory.mjs hash <absDir>
//
// Exit codes: 0 ok, 1 verification/usage failure, 2 path-guard violation.
import process from 'node:process'
import { commitMemory, verifyMemory, treeHash } from '../lib/memory-lib.mjs'

function flag(name, map) {
  return map.has(name) ? map.get(name) : undefined
}

function parseArgs(argv) {
  const map = new Map()
  let i = 0
  while (i < argv.length) {
    const tok = argv[i]
    if (tok.startsWith('--')) {
      map.set(tok.slice(2), argv[i + 1])
      i += 2
    } else {
      map.set('_pos' + map.size, tok)
      i += 1
    }
  }
  return map
}

async function main(argv) {
  const m = parseArgs(argv)
  const mode = m.get('mode') ?? m.get('_pos0')
  if (mode === 'generate') {
    const candidate = m.get('candidate') ?? m.get('_pos1')
    const wave = m.get('wave') ?? m.get('_pos2')
    const actor = m.get('actor') ?? m.get('_pos3')
    const verdict = m.get('verdict') ?? m.get('_pos4')
    const score = m.get('score') ?? m.get('_pos5')
    const findings = m.get('findings') ?? m.get('_pos6') ?? ''
    const out = m.get('out') ?? m.get('_pos7')
    const root = m.get('root') ?? m.get('_pos8')
    if (!candidate || !wave || !actor || !verdict || score === undefined || !out || !root) {
      throw new Error('generate requires --candidate --wave --actor --verdict --score --out --root')
    }
    const manifest = await commitMemory({
      candidate, wave, actor, verdict, score: Number(score), findings, out, root,
    })
    process.stdout.write(JSON.stringify({ ok: true, ...manifest }) + '\n')
    return 0
  }
  if (mode === 'verify') {
    const dir = m.get('dir') ?? m.get('_pos1')
    if (!dir) throw new Error('verify requires --dir <absDir>')
    const res = await verifyMemory(dir)
    process.stdout.write(JSON.stringify(res) + '\n')
    return res.ok ? 0 : 1
  }
  if (mode === 'hash') {
    const dir = m.get('dir') ?? m.get('_pos1')
    if (!dir) throw new Error('hash requires --dir <absDir>')
    process.stdout.write(JSON.stringify({ tree_sha256: await treeHash(dir) }) + '\n')
    return 0
  }
  throw new Error(`unknown mode: ${mode ?? '<missing>'}`)
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0 },
  (err) => {
    const guard = /escapes allowed root|invalid actor name|invalid verdict|invalid wave/.test(String(err?.message ?? ''))
    process.stderr.write(`commit-memory: ${err?.message ?? err}\n`)
    process.exitCode = guard ? 2 : 1
  },
)