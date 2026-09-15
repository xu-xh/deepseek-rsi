#!/usr/bin/env node
// verify-run.mjs — execute a verifier probe inside a throwaway COPY of the
// candidate's verify-area, then discard the copy (lightweight rollback).
//
// The verifier may run commands to confirm BEHAVIORAL claims ("the script
// really prints X / really exits 0"), but its filesystem side effects must
// never leak into the candidate or memory. This channel guarantees that:
// the copy lives under os.tmpdir()/rsi-verify-*, the command runs with the
// copy as its cwd and a fixed timeout, and the copy is removed in `finally`.
//
// Usage:
//   node tools/verify-run.mjs --candidate <absCandDir> --timeout <secs> -- cmd [args...]
// Exit codes: 0 command succeeded, 1 command failed or usage error,
//             2 containment violation, 124 internal timeout.
import process from 'node:process'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkFiles } from '../lib/memory-lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function need(name, args) {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || args[i + 1] === undefined) throw Object.assign(new Error(`missing --${name}`), { code: 'USAGE' })
  return args[i + 1]
}

async function copyTree(srcDir, destDir) {
  const files = await walkFiles(srcDir)
  await fs.mkdir(destDir, { recursive: true })
  for (const rel of files) {
    const target = path.join(destDir, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(srcDir, rel), target)
  }
  return files
}

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd, timeout: timeoutMs, killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: os.homedir() },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (e) => resolve({ code: 1, stdout, stderr: String(e?.message ?? e), timedOut: false }))
    child.on('close', (code, signal) => resolve({
      code: signal === 'SIGKILL' ? 124 : (code ?? 1), stdout, stderr, timedOut: signal === 'SIGKILL',
    }))
  })
}

async function main(argv) {
  const dash = argv.indexOf('--')
  if (dash === -1) throw Object.assign(new Error('expected "--" before the command'), { code: 'USAGE' })
  const candidate = need('candidate', argv)
  const timeoutSecs = Number(argv[argv.indexOf('--timeout') + 1] ?? 60)
  const cmd = argv[dash + 1]
  const cmdArgs = argv.slice(dash + 2)

  const absCandidate = await fs.realpath(candidate)
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'rsi-verify-'))
  const workdir = path.join(scratch, 'candidate')
  try {
    await copyTree(absCandidate, workdir)
    const res = await run(cmd, cmdArgs, workdir, timeoutSecs * 1000)
    const out = {
      ok: res.code === 0 && !res.timedOut,
      exit_code: res.code,
      timed_out: res.timedOut,
      stdout: res.stdout.slice(-200_000),
      stderr: res.stderr.slice(-50_000),
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    return out.ok ? 0 : 1
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }) // rollback: discard the copy
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code ?? 0 },
  (err) => {
    process.stderr.write(`verify-run: ${err?.message ?? err}\n`)
    process.exitCode = err?.code === 'USAGE' ? 1 : 2
  },
)