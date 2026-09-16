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
//   node tools/commit-memory.mjs --mode list --out <commitsRoot> [--json]
//     (auto-detects wave-first `commitsRoot/<w<wave>>/<actor>/` and
//      actor-first `commitsRoot/<actor>/<commitDir>/` layouts)
//
// Usage (positional form — equivalent):
//   node tools/commit-memory.mjs generate <absCandDir> <n> <name> \
//       <verdict> <score> [findings] <out> <root>
//   node tools/commit-memory.mjs verify <absDir>
//   node tools/commit-memory.mjs hash <absDir>
//
// Exit codes: 0 ok, 1 verification/usage failure, 2 path-guard violation.
import process from 'node:process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { commitMemory, verifyMemory, treeHash, MANIFEST_NAME } from '../lib/memory-lib.mjs'

function flag(name, map) {
  return map.has(name) ? map.get(name) : undefined
}

function parseArgs(argv) {
  const map = new Map()
  let i = 0
  let pos = 0
  while (i < argv.length) {
    const tok = argv[i]
    if (tok.startsWith('--')) {
      if (tok === '--json') {
        // valueless flag; must not consume the next token as its value,
        // and must not shift positional indices
        map.set('json', true)
        i += 1
      } else {
        map.set(tok.slice(2), argv[i + 1])
        i += 2
      }
    } else {
      map.set('_pos' + pos, tok)
      pos += 1
      i += 1
    }
  }
  return map
}

/**
 * List committed memory rows under `commitsRoot`. Two on-disk layouts are
 * recognized by the shape of top-level entries:
 *   - wave-first (real commitMemory output): `commitsRoot/<w<wave>>/<actor>/`,
 *     detected when any top-level directory matches /^w\d+$/;
 *   - actor-first (audit fixtures): `commitsRoot/<actor>/<commitDir>/`.
 * Only directories containing a parseable MANIFEST.json are listed; stray
 * files, symlinks, and malformed manifests are ignored. The actor column is
 * the manifest `actor` field when present, else the actor directory name;
 * wave is the manifest `wave`. Sorted by (actor, numeric wave). Returns
 * [{wave, actor, commit, tree}].
 */
async function listCommits(commitsRoot) {
  let top
  try {
    top = await fs.readdir(commitsRoot, { withFileTypes: true })
  } catch (err) {
    if (err?.code === 'ENOENT') {
      // a misspelled path should not silently read as an empty tree
      throw new Error(`list requires an existing commits root: ${commitsRoot}`)
    }
    return [] // unreadable root: nothing to list
  }
  const waveFirst = top.some((e) => e.isDirectory() && /^w\d+$/.test(e.name))
  const rows = []
  for (const a of top) {
    if (!a.isDirectory()) continue // stray file at root
    if (waveFirst && !/^w\d+$/.test(a.name)) continue // stray dir next to wave dirs
    const firstLevel = path.join(commitsRoot, a.name)
    let commits
    try {
      commits = await fs.readdir(firstLevel, { withFileTypes: true })
    } catch {
      continue
    }
    for (const c of commits) {
      if (!c.isDirectory()) continue // symlinks and stray files are not commits
      let manifest
      try {
        manifest = JSON.parse(await fs.readFile(path.join(firstLevel, c.name, MANIFEST_NAME), 'utf-8'))
      } catch {
        continue // no MANIFEST.json (or unreadable/malformed): not a commit
      }
      const wave = Number(manifest.wave)
      const tree = String(manifest.tree_sha256 ?? '')
      if (!Number.isInteger(wave) || wave < 0) continue // unusable wave
      if (!/^[0-9a-f]{64}$/i.test(tree)) continue // unusable digest
      const actor = typeof manifest.actor === 'string' && manifest.actor !== ''
        ? manifest.actor
        : (waveFirst ? c.name : a.name)
      rows.push({ wave, actor, commit: c.name, tree })
    }
  }
  rows.sort((x, y) => (x.actor < y.actor ? -1 : x.actor > y.actor ? 1 : x.wave - y.wave))
  return rows
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
  if (mode === 'list') {
    // Accept --out <root>; positional fallbacks cover the fully positional
    // form (`list <root>`) and the flag mode with a positional root
    // (`--mode list --json <root>`).
    const out = m.get('out') ?? m.get('_pos1') ?? m.get('_pos0')
    if (!out) throw new Error('list requires --out <commitsRoot>')
    const rows = await listCommits(out)
    if (m.has('json')) {
      process.stdout.write(JSON.stringify(rows.map((r) => ({
        wave: r.wave, actor: r.actor, commit: r.commit, hash: r.tree.slice(0, 12),
      }))) + '\n')
    } else {
      for (const r of rows) {
        process.stdout.write(`w${String(r.wave).padStart(3, '0')} ${r.actor} ${r.commit} ${r.tree.slice(0, 12)}\n`)
      }
    }
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