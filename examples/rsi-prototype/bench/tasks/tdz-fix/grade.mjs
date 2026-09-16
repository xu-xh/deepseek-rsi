#!/usr/bin/env node
// bench: natural-defect task 5 — fix a TDZ initialization-order bug.
// Origin: real defect in the workflow body — the verifier prompt template
// referenced ${proto} at module scope before `const proto` was declared,
// throwing `Cannot access 'proto' before initialization` only at runtime
// (syntax gates could not catch it). Candidate must fix `broken.mjs` so it
// runs and still prints exactly `VALUE=42`.
// The grader hands the candidate a broken.mjs with a similar TDZ bug and only
// requires the fixed file to execute with the exact expected output.
import { promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const BROKEN = `const OUT = \`VALUE=\${V}\`\nconst V = 42\nprocess.stdout.write(OUT + '\\n')\n`
const FIXED = `const V = 42\nconst OUT = \`VALUE=\${V}\`\nprocess.stdout.write(OUT + '\\n')\n`

export async function grade(dir, { runner = process.execPath } = {}) {
  const checks = []
  const src = await fs.readFile(path.join(dir, 'broken.mjs'), 'utf8').catch(() => null)
  checks.push({ name: 'broken.mjs exists (fixed file)', pass: !!src, got: src ? 'present' : 'missing' })
  if (!src) return { score: 0, max: 1, checks }

  // The candidate fixes the file in place; verify it now runs and prints exact output.
  let r = spawnSync(runner, ['broken.mjs'], { cwd: dir, encoding: 'utf-8', timeout: 5000 })
  const pass = r.status === 0 && (r.stdout ?? '').trim() === 'VALUE=42'
  checks.push({ name: 'fixed file runs and prints VALUE=42', pass, got: `exit=${r.status} out=${JSON.stringify((r.stdout ?? '').trim()).slice(0, 40)} ${r.error ? 'TIMEOUT' : ''}` })
  return { score: (src ? 1 : 0) + (pass ? 1 : 0), max: 2, checks }
}

// Exported for selfcheck negative sampling: the unfixed file must fail.
export const TDZ_BROKEN = BROKEN
export const TDZ_FIXED = FIXED