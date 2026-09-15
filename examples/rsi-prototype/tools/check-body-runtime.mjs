#!/usr/bin/env node
// check-body-runtime.mjs — no-LLM runtime probe of the workflow body.
//
// Executes workflows/wave-rsi.body.js against a stub engine (agent/parallel/
// phase/log) with a minimal args object, so initialization-order bugs like a
// template literal referencing a later-declared const (TDZ) fail here instead
// of in a real model run. Also exercises the W3 budget/resume termination
// paths (done / stalled / budget_exhausted / resumedFrom) with no model calls.
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

async function runOnce(overrides = {}) {
  const args = { root, maxWaves: 2, actorCount: 2, topic: 'stub topic', ...overrides }
  const callLog = []
  const phase = () => {}
  const log = () => {}
  async function agent(prompt, opts = {}) {
    callLog.push(opts.label ?? '(agent)')
    const label = String(opts.label ?? '')
    if (args.stubActorBlank && label.startsWith('actor-')) return ''
    if (opts.schema?.properties?.verdict) {
      return { verdict: 'PASS', score: 90, findings: 'stub verdict', evidence: 'stub' }
    }
    if (opts.schema?.properties?.action) {
      return args.stubCurriculumNext
        ? { action: 'next_wave', next_topic: 'stub next', reason: 'stub continue' }
        : { action: 'done', next_topic: '', reason: 'stub convergence' }
    }
    return `stub completion for ${label}` // actor / committer
  }
  async function parallel(thunks) {
    return Promise.all(thunks.map((t) => t().catch(() => null)))
  }
  const body = await fs.readFile(BODY, 'utf8')
  // new Function injects the engine globals explicitly; the body keeps its own
  // top-level `return` inside the generated async wrapper.
  const factory = new Function('args', 'phase', 'log', 'agent', 'parallel', `return (async () => {\n${body}\n})()`)
  const result = await factory(args, phase, log, agent, parallel)
  return { result, callLog }
}

const body = await fs.readFile(BODY, 'utf8')

let result
let callLog = []
try {
  ({ result, callLog } = await runOnce())
} catch (err) {
  check('body executes without initialization errors', false, `${err?.name}: ${err?.message}`)
  process.exitCode = 1
  process.exit(1)
}

check('body executed without throwing', result !== undefined)
check('result.ok === true', result?.ok === true)
check('default run terminates as done (curriculum convergence)',
  result?.termination === 'done',
  JSON.stringify(result?.termination))
check('agents were invoked (explore -> verify -> commit -> curriculum)', callLog.length >= 5,
  `${callLog.length} calls: ${callLog.slice(-4).join(', ')}`)
try {
  JSON.stringify(result)
  check('result is JSON-serializable', true)
} catch {
  check('result is JSON-serializable', false)
}

// W3 budget/resume termination paths
;(async () => {
  const stalled = await runOnce({ stubActorBlank: true, stubCurriculumNext: true, maxConsecutiveStalls: 1 })
  check('all actors blank + curriculum wants next -> stalled', stalled.result.termination === 'stalled',
    JSON.stringify(stalled.result.termination))

  const budgeted = await runOnce({ stubCurriculumNext: true, maxWaves: 1 })
  check('curriculum keeps pushing past maxWaves -> budget_exhausted',
    budgeted.result.termination === 'budget_exhausted',
    JSON.stringify(budgeted.result.termination))

  const resumed = await runOnce({ startWave: 2 })
  check('startWave=2 resumes from wave 2 and reports resumedFrom',
    resumed.result.resumedFrom === 2 && resumed.result.waves?.[0]?.wave === 2,
    JSON.stringify({ resumedFrom: resumed.result.resumedFrom, firstWave: resumed.result.waves?.[0]?.wave }))

  console.log(failures === 0 ? '\nBODY-RUNTIME OK' : `\nBODY-RUNTIME FAILED: ${failures}`)
  process.exitCode = failures === 0 ? 0 : 1
})().catch((err) => {
  console.error(err)
  process.exitCode = 1
})