// memory-lib.mjs — memory-commit gate primitives (no dependencies).
// Mirrors, in miniature, RSIAgent's host-side commit gate: hashed manifest,
// atomic install, path-guard. Model parameters never change; learning is the
// artifact tree.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const SCHEMA_VERSION = 1
export const MANIFEST_NAME = 'MANIFEST.json'

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Walk `dir` and return sorted relative file paths (bytes, no symlink escape). */
export async function walkFiles(dir, base = dir, acc = []) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    if (e.isSymbolicLink()) continue // never follow symlinks out of the tree
    if (e.isDirectory()) await walkFiles(abs, base, acc)
    else if (e.isFile()) acc.push(path.relative(base, abs))
  }
  return acc.sort()
}

/** Directory tree digest: sha256 of sorted "rel:hex" lines. MANIFEST.json is
 * metadata, not content; excluding it keeps verify() able to recompute the
 * hash that commit wrote before the manifest existed. */
export async function treeHash(dir) {
  const files = (await walkFiles(dir)).filter((r) => r !== MANIFEST_NAME)
  const lines = []
  for (const rel of files) {
    const data = await fs.readFile(path.join(dir, rel))
    lines.push(`${rel}:${sha256(data)}`)
  }
  return sha256(lines.join('\n') + '\n')
}

/** Per-file digest map for a directory (content files only). */
export async function fileDigests(dir) {
  const files = (await walkFiles(dir)).filter((r) => r !== MANIFEST_NAME)
  const out = {}
  for (const rel of files) {
    out[rel] = sha256(await fs.readFile(path.join(dir, rel)))
  }
  return out
}

export function isValidVerdict(v) {
  return v === 'PASS' || v === 'FAIL' || v === 'UNVERIFIED'
}

export function isValidActorName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) && !name.includes('..')
}

export function waveLabel(wave) {
  if (!/^\d+$/.test(String(wave))) throw new Error(`invalid wave: ${wave}`)
  return `w${String(wave).padStart(3, '0')}`
}

/**
 * Commit a candidate directory under `out/<waveLabel>/<actor>/` with a
 * MANIFEST.json and an append-only journal line. Atomic (tmp + rename).
 *
 * Path guard: `candidate` must resolve inside `root` (the allowed workspace),
 * so a candidate path can never escape the memory area, and actor names can
 * never traverse.
 */
export async function commitMemory({ candidate, wave, actor, verdict, score, findings, out, root }) {
  if (!isValidActorName(actor)) throw new Error(`invalid actor name: ${actor}`)
  if (!isValidVerdict(verdict)) throw new Error(`invalid verdict: ${verdict}`)
  if (!Number.isFinite(score)) throw new Error(`invalid score: ${score}`)

  const absRoot = path.resolve(root)
  const absCandidate = await fs.realpath(candidate)
  if (absCandidate !== absRoot && !absCandidate.startsWith(absRoot + path.sep)) {
    throw new Error(`path guard: candidate escapes allowed root ${absRoot}: ${absCandidate}`)
  }

  const dest = path.join(path.resolve(out), waveLabel(wave), actor)
  await fs.mkdir(dest, { recursive: true })

  const files = await fileDigests(absCandidate)
  for (const rel of Object.keys(files)) {
    const src = path.join(absCandidate, rel)
    const target = path.join(dest, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp-${process.pid}`
    await fs.copyFile(src, tmp)
    await fs.rename(tmp, target)
  }

  const manifest = {
    schema_version: SCHEMA_VERSION,
    wave: Number(wave),
    actor,
    verdict,
    score: Number(score),
    findings: String(findings ?? '').slice(0, 2000),
    files,
    tree_sha256: await treeHash(dest),
    ts: new Date().toISOString(),
  }
  await writeAtomic(path.join(dest, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n')

  const journalPath = path.join(path.resolve(out), 'journal.jsonl')
  await fs.mkdir(path.dirname(journalPath), { recursive: true })
  await fs.appendFile(journalPath, JSON.stringify({
    ts: manifest.ts, wave: manifest.wave, actor,
    verdict, score: manifest.score, tree_sha256: manifest.tree_sha256,
  }) + '\n')

  return manifest
}

/** Verify a committed tree against its MANIFEST.json. Returns {ok, reason}. */
export async function verifyMemory(dir) {
  const manifestPath = path.join(dir, 'MANIFEST.json')
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
  } catch {
    return { ok: false, reason: `missing or unreadable MANIFEST.json in ${dir}` }
  }
  const files = await fileDigests(dir)
  const manifestFiles = manifest.files ?? {}
  const rels = Object.keys(files).filter((r) => r !== 'MANIFEST.json')
  const expected = Object.keys(manifestFiles).filter((r) => r !== 'MANIFEST.json').sort()
  if (JSON.stringify(rels.sort()) !== JSON.stringify(expected)) {
    return { ok: false, reason: 'file set differs from manifest' }
  }
  for (const rel of rels) {
    if (files[rel] !== manifestFiles[rel]) {
      return { ok: false, reason: `hash mismatch: ${rel}` }
    }
  }
  const tree = await treeHash(dir)
  if (tree !== manifest.tree_sha256) {
    return { ok: false, reason: `tree_sha256 mismatch: ${tree} != ${manifest.tree_sha256}` }
  }
  return { ok: true, reason: 'tree matches manifest' }
}

export async function writeAtomic(target, text) {
  const tmp = `${target}.tmp-${process.pid}`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, target)
}