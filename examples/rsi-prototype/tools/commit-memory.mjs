#!/usr/bin/env node
// commit-memory.mjs — CLI for the memory-commit gate (no dependencies).
//
// Usage:
//   node tools/commit-memory.mjs --mode generate \
//       --candidate <absCandDir> --wave <n> --actor <name> \
//       --verdict PASS|FAIL|UNVERIFIED --score <0-100> \
//       [--findings text] --out <absCommitsDir> --root <absAllowedRoot>
//   node tools/commit-memory.mjs --mode verify --dir <absCommittedDir>
//   node tools/commit-memory.mjs --mode hash --dir <absDir>
//
// Exit codes: 0 ok, 1 verification/usage failure, 2 path-guard violation.
import process from 'node:process'
import { commitMemory, verifyMemory, treeHash } from '../lib/memory-lib.mjs'

function arg(name, argv) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

async function main(argv) {
  const mode = argv[0]
  if (mode === 'generate') {
    const candidate = argv[1]
    const wave = argv[2]
    const actor = argv[3]
    const verdict = argv[4]
    const score = argv[5]
    const findings = argv[6] ?? ''
    const out = argv[7]
    const root = argv[8]
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
    const res = await verifyMemory(argv[1])
    process.stdout.write(JSON.stringify(res) + '\n')
    return res.ok ? 0 : 1
  }
  if (mode === 'hash') {
    const dir = argv[1]
    process.stdout.write(JSON.stringify({ tree_sha256: await treeHash(dir) }) + '\n')
    return 0
  }
  throw new Error(`unknown mode: ${mode}`)
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0 },
  (err) => {
    const guard = /escapes allowed root|invalid actor name|invalid verdict|invalid wave/.test(String(err?.message ?? ''))
    process.stderr.write(`commit-memory: ${err?.message ?? err}\n`)
    process.exitCode = guard ? 2 : 1
  },
)