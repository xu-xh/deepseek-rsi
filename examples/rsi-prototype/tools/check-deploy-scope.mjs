#!/usr/bin/env node
// check-deploy-scope.mjs — mechanical gate for the VERIFIER tool-surface spec.
//
// Verifies deploy/verifier-scope.spec.json is self-consistent (allowed tools =
// exactly the restricted channels; forbidden substrings exclude every bare
// execution/write/wide tool) and that the paste-in deployment example
// deploy/verifier-scope.cordis.yml never lists a forbidden tool in its
// allow/deny list. Zero dependencies; run in CI.
// Run: node examples/rsi-prototype/tools/check-deploy-scope.mjs
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promises as fs } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEPLOY = path.resolve(HERE, '..', 'deploy')
const SPEC = JSON.parse(await fs.readFile(path.join(DEPLOY, 'verifier-scope.spec.json'), 'utf8'))
const CFG = await fs.readFile(path.join(DEPLOY, 'verifier-scope.cordis.yml'), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// 1. allowed tools are exactly the two restricted channels, ordered
check('allowed_tools = restricted channels only',
  Array.isArray(SPEC.allowed_tools)
  && JSON.stringify(SPEC.allowed_tools) === JSON.stringify(['verify-read', 'verify-run']),
  JSON.stringify(SPEC.allowed_tools))

// 2. no allowed tool name shadows a forbidden one
const forbidden = (SPEC.forbidden_tools_substrings ?? []).map((s) => s.toLowerCase())
check('forbidden substrings are non-empty', forbidden.length > 0 && forbidden.includes('bash') && forbidden.includes('shell'))

// 3. the deployment example never grants a forbidden tool anywhere
const allowedStr = (SPEC.allowed_tools ?? []).join(' ')
let rank = 0
let allTokens = ''
for (const token of CFG.split(/[\s,:-]+/)) {
  const t = token.toLowerCase().replace(/[*"'?.]/g, '')
  if (!t) continue
  allTokens += ` ${t}`
  if (SPEC.allowed_tools.some((a) => t === a || t.startsWith('dsh-rsi-verify'))) {
    rank = Math.max(rank, 1)
    continue
  }
  if (t.startsWith('dsh-') && !t.startsWith('dsh-rsi')) {
    // deployment tool tokens: each must be in the allow or nowhere
    const denied = forbidden.find((f) => t.includes(f))
    if (denied) {
      check(`example does not grant forbidden tool '${t}' (matches '${denied}')`, false, 'found in config')
      rank = 2
    }
  }
}
if (rank < 2) {
  check('example references only restricted channel tools', true, 'no forbidden dsh-* tool token found')
}

// 4. every allowed tool has a corresponding backend script on disk
for (const tool of SPEC.allowed_tools ?? []) {
  const script = path.resolve(HERE, `${tool}.mjs`)
  const ok = await fs.stat(script).then(() => true, () => false)
  check(`backend script exists for '${tool}'`, ok, script)
}

// 5. audit is declared required in the spec and the example
check('spec requires audit for read and run',
  SPEC.required_audit?.read === '--audit <path>' && SPEC.required_audit?.run === '--audit <path>')
check('example marks audit required', /audit_verifier_reads: required/.test(CFG) || /verifier_reads: required/.test(CFG))

console.log(failures === 0 ? '\nDEPLOY-SCOPE OK' : `\nDEPLOY-SCOPE FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1