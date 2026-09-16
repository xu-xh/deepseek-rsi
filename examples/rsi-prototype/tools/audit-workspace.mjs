#!/usr/bin/env node
// audit-workspace.mjs — cross-root consistency audit between waves/ and
// commits/ (task T3 of the DSH-real-dev evaluation). Zero dependencies.
//
// Usage:
//   node tools/audit-workspace.mjs --waves <wavesRoot> --commits <commitsRoot> [--json]
//
// For every planned wave `<wavesRoot>/<wNNN>/<actor>/`:
//   - commits/<wNNN>/<actor>/MANIFEST.json exists and its `wave` value equals
//     the numeric wave of the directory name  -> `OK <wNNN> <actor>`
//   - commits/<wNNN>/<actor>/MANIFEST.json is missing
//     -> `MISSING <wNNN> <actor>` (exit 1)
//   - manifest exists but its `wave` value differs from the directory wave
//     -> `WAVE-MISMATCH <wNNN> <actor> <manifestWave>` (exit 1)
// Wave-root entries whose names do not match /^w\d+$/ (or that are not
// directories) are reported as `SKIP <entryName>` and never affect the exit
// code. Commits-side (wave, actor) directories containing MANIFEST.json with
// no matching planned pair are reported as `ORPHAN <wNNN> <actor>`; orphans
// are warnings and never affect the exit code.
//
// Exit codes: 0 = green (no MISSING/WAVE-MISMATCH), 1 = at least one
// MISSING or WAVE-MISMATCH, 2 = missing --waves/--commits (usage, stderr).
//
// --json prints only a JSON array [{kind, wave, actor, extra?}] to stdout
// (kind in OK|MISSING|WAVE-MISMATCH|ORPHAN|SKIP), rows sorted by
// (numeric wave, actor); `wave` is the number from the wave directory name.
import process from 'node:process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const WAVE_RE = /^w\d+$/
const MANIFEST = 'MANIFEST.json'

function parseArgs(argv) {
  const args = { waves: undefined, commits: undefined, json: false }
  let i = 0
  while (i < argv.length) {
    const tok = argv[i]
    if (tok === '--json') {
      args.json = true
      i += 1
    } else if (tok === '--waves' || tok === '--commits') {
      const key = tok.slice(2)
      const value = argv[i + 1]
      if (value !== undefined && !value.startsWith('--')) {
        args[key] = value
        i += 2
      } else {
        args[key] = '' // flag present but valueless -> treated as missing
        i += 1
      }
    } else {
      i += 1 // unknown tokens are ignored
    }
  }
  return args
}

async function readDirOrEmpty(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    // a root that does not exist yet audits as empty, not as an error
    if (err?.code === 'ENOENT') return []
    throw err
  }
}

/** Numeric wave parsed from a /^w\d+$/ directory name. */
function waveNumOf(name) {
  return Number(name.slice(1))
}

/**
 * Usable numeric value of a manifest `wave` field, or NaN when the field is
 * missing or not an integer >= 0 (numbers and plain digit strings coerce).
 */
function manifestWaveNum(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? n : NaN
}

/**
 * Collect one audit row per planned wave directory and per orphaned commit.
 * Returns rows [{kind, waveNum, waveName, actor, extra}] unsorted.
 */
async function collectRows(waves, commits) {
  const rows = []
  const planned = new Map() // waveName -> Set(actor names present under it)

  for (const e of await readDirOrEmpty(waves)) {
    if (!WAVE_RE.test(e.name) || !e.isDirectory()) {
      rows.push({ kind: 'SKIP', waveNum: Infinity, name: e.name, actor: null, extra: e.name })
      continue
    }
    const waveNum = waveNumOf(e.name)
    const actors = new Set()
    planned.set(e.name, actors)
    for (const a of await readDirOrEmpty(path.join(waves, e.name))) {
      if (!a.isDirectory()) continue
      actors.add(a.name)
      const manifestPath = path.join(commits, e.name, a.name, MANIFEST)
      let manifest
      try {
        manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
      } catch (err) {
        if (err?.code === 'ENOENT') {
          rows.push({ kind: 'MISSING', waveNum, name: e.name, actor: a.name })
        } else {
          // the file exists but is not a parseable manifest: loud drift
          rows.push({ kind: 'WAVE-MISMATCH', waveNum, name: e.name, actor: a.name, extra: 'unparseable' })
        }
        continue
      }
      const mNum = manifestWaveNum(manifest.wave)
      if (!Number.isNaN(mNum) && mNum === waveNum) {
        rows.push({ kind: 'OK', waveNum, name: e.name, actor: a.name })
      } else {
        const extra = Number.isNaN(mNum)
          ? (manifest.wave === undefined ? 'missing' : String(manifest.wave))
          : mNum
        rows.push({ kind: 'WAVE-MISMATCH', waveNum, name: e.name, actor: a.name, extra })
      }
    }
  }

  for (const w of await readDirOrEmpty(commits)) {
    if (!WAVE_RE.test(w.name) || !w.isDirectory()) continue
    for (const a of await readDirOrEmpty(path.join(commits, w.name))) {
      if (!a.isDirectory()) continue
      // a commits-side directory counts as a commit only when MANIFEST.json
      // exists in it; existence decides, matching the OK/MISSING rule
      let hasManifest = false
      try {
        hasManifest = (await fs.stat(path.join(commits, w.name, a.name, MANIFEST))).isFile()
      } catch {
        hasManifest = false
      }
      if (!hasManifest) continue
      const actors = planned.get(w.name)
      if (actors?.has(a.name)) continue // matched pair already reported above
      rows.push({ kind: 'ORPHAN', waveNum: waveNumOf(w.name), name: w.name, actor: a.name })
    }
  }

  return rows
}

function formatPlain(row) {
  switch (row.kind) {
    case 'OK': return `OK ${row.name} ${row.actor}`
    case 'MISSING': return `MISSING ${row.name} ${row.actor}`
    case 'WAVE-MISMATCH': return `WAVE-MISMATCH ${row.name} ${row.actor} ${row.extra}`
    case 'ORPHAN': return `ORPHAN ${row.name} ${row.actor}`
    case 'SKIP': return `SKIP ${row.extra}`
    default: return `${row.kind} ${row.name} ${row.actor}`
  }
}

function toJson(row) {
  const out = { kind: row.kind, wave: row.kind === 'SKIP' ? null : row.waveNum, actor: row.actor }
  if (row.extra !== undefined) out.extra = row.extra
  return out
}

async function main(argv) {
  const args = parseArgs(argv)
  if (!args.waves || !args.commits) {
    process.stderr.write('usage: node tools/audit-workspace.mjs --waves <wavesRoot> --commits <commitsRoot> [--json]\n')
    return 2
  }

  const rows = await collectRows(args.waves, args.commits)
  rows.sort((x, y) => x.waveNum - y.waveNum
    || (x.kind === 'SKIP' ? (y.kind === 'SKIP' ? (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) : 1)
      : y.kind === 'SKIP' ? -1
        : (x.actor < y.actor ? -1 : x.actor > y.actor ? 1 : 0)))

  if (args.json) {
    process.stdout.write(JSON.stringify(rows.map(toJson)) + '\n')
  } else {
    for (const row of rows) process.stdout.write(formatPlain(row) + '\n')
  }

  const bad = rows.some((r) => r.kind === 'MISSING' || r.kind === 'WAVE-MISMATCH')
  return bad ? 1 : 0
}

process.exitCode = await main(process.argv.slice(2))
