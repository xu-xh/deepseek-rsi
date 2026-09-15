#!/usr/bin/env node
// check-body-runtime.mjs — no-LLM runtime probe of the workflow body.
//
// Executes workflows/wave-rsi.body.js against a stub engine (agent/parallel/
// phase/log) with a minimal args object, so initialization-order bugs like a
// template literal referencing a later-declared const (TDZ) fail here instead
// of in a real model run. Verifies the body completes one wave and returns a
// JSON-serializable result.
// Run: node examples/rsi-prototype/tools/check-body-runtime.mjs
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promises as fs } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BODY = path.resolve(HERE, '..', 'workflows', 'wave-rsi.body.js')
const root = path.resolve(HERE, '..', '..', '..') // repo root (deepseek-rsi-dev)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const phase = () => {}
const log = () => {}
const callLog = []
async function agent(prompt, opts = {}) {
  callLog.push(opts.label ?? '(agent)')
  if (opts.schema?.properties?.verdict) {
    return { verdict: 'PASS', score: 90, findings: 'stub verdict', evidence: 'stub' }
  }
  if (opts.schema?.properties?.action) {
    return { action: 'done', next_topic: '', reason: 'stub convergence' }
  }
  return `stub completion for ${opts.label ?? ''}` // actor / committer
}
async function parallel(thunks) {
  return Promise.all(thunks.map((t) => t().catch(() => null)))
}

const args = { root, maxWaves: 2, actorCount: 2, topic: 'stub topic' }
const body = await fs.readFile(BODY, 'utf8')

// new Function injects the engine globals explicitly; the body keeps its own
// top-level `return` inside the generated async wrapper.
const factory = new Function('args', 'phase', 'log', 'agent', 'parallel', `return (async () => {\n${body}\n})()`)
let result
try {
  result = await factory(args, phase, log, agent, parallel)
} catch (err) {
  check('body executes without initialization errors', false, `${err?.name}: ${err?.message}`)
  process.exitCode = 1
  process.exit(1)
}

check('body executed without throwing', result !== undefined)
check('result.ok === true', result?.ok === true)
check('one wave ran and curriculum converged', Array.isArray(result?.waves) && result.waves.length >= 1 && result.finalDecision?.action === 'done', JSON.stringify(result?.finalDecision))
check('agents were invoked (explore -> verify -> commit -> curriculum)', callLog.length >= 5, `${callLog.length} calls: ${callLog.slice(-4).join(', ')}`)
try {
  JSON.stringify(result)
  check('result is JSON-serializable', true)
} catch {
  check('result is JSON-serializable', false)
}

console.log(failures === 0 ? '\nBODY-RUNTIME OK' : `\nBODY-RUNTIME FAILED: ${failures}`)
process.exitCode = failures === 0 ? 0 : 1