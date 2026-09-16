#!/usr/bin/env node
// verify-read.mjs — restricted read-only access channel for the VERIFIER.
//
// The verifier may only read files inside an allowed root (its candidate's
// verify-area). This channel enforces that mechanically at the tool boundary:
// realpath containment, no symlink escape, no write verbs at all. Deployments
// that can shape the verifier agent's tool surface (DSH sandbox/guard) should
// additionally give the verifier ONLY this channel — see README "Isolation".
//
// Usage:
//   node tools/verify-read.mjs --root <allowedAbsRoot> --path <absOrRelPath> [--max-bytes N]
//   node tools/verify-read.mjs --root <allowedAbsRoot> --list
//
// Exit codes: 0 ok, 1 verification/usage failure, 2 containment violation.
import process from 'node:process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

function need(name, args) {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || args[i + 1] === undefined) throw new Error(`missing --${name}`)
  return args[i + 1]
}

async function resolveInside(root, p) {
  const absRoot = await fs.realpath(root)
  const target = path.isAbsolute(p) ? p : path.join(absRoot, p)
  const real = await fs.realpath(target) // throws ENOENT outside the root
  if (real !== absRoot && !real.startsWith(absRoot + path.sep)) {
    throw Object.assign(new Error(`containment violation: ${real} escapes ${absRoot}`), { code: 'CONTAIN' })
  }
  return { absRoot, real }
}

async function main(argv) {
  const root = need('root', argv)
  const absRoot = await fs.realpath(root)
  // Without --audit there must be no audit file and no write side effect; the
  // indexOf(-1)+1 trick would read argv[0] ("--root"/"--candidate") as the file.
  const auditIdx = argv.indexOf('--audit')
  const auditFile = auditIdx >= 0 ? argv[auditIdx + 1] : undefined
  const audit = async (target, ok, note = '') => {
    if (!auditFile) return
    await fs.appendFile(auditFile,
      JSON.stringify({ tool: 'verify-read', ts: new Date().toISOString(), root: absRoot, target, ok, note }) + '\n')
  }
  if (argv.includes('--list')) {
    const files = []
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name)
        if (e.isSymbolicLink()) continue // verifier must never follow links
        if (e.isDirectory()) await walk(abs)
        else if (e.isFile()) files.push(path.relative(absRoot, abs))
      }
    }
    await walk(absRoot)
    process.stdout.write(JSON.stringify({ files: files.sort() }) + '\n')
    return 0
  }
  const p = need('path', argv)
  let real
  try {
    ({ real } = await resolveInside(root, p))
  } catch (err) {
    await audit(p, false, `denied: ${err?.code ?? 'ERR'}`) // attempted escapes are recorded too
    throw err
  }
  const st = await fs.stat(real)
  if (!st.isFile()) throw Object.assign(new Error(`not a file: ${real}`), { code: 'CONTAIN' })
  const maxBytes = Number(argv[argv.indexOf('--max-bytes') + 1] ?? 200_000)
  const data = await fs.readFile(real)
  await audit(p, true)
  if (data.length > maxBytes) {
    throw new Error(`file exceeds --max-bytes ${maxBytes}: ${Buffer.byteLength(data)} bytes`)
  }
  const text = data.toString('utf8').replace(/\r\n/g, '\n')
  process.stdout.write(`--- ${path.relative(absRoot, real)} ---\n`)
  process.stdout.write(text.endsWith('\n') ? text : text + '\n')
  return 0
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0 },
  (err) => {
    process.stderr.write(`verify-read: ${err?.message ?? err}\n`)
    process.exitCode = err?.code === 'CONTAIN' ? 2 : 1
  },
)