// wave-rsi.body.js — RSI wave loop, DSH-native (workflow tool body).
//
// Pass the CONTENT of this file as the workflow tool's `script` parameter,
// with `meta` from meta.json and `args` described in ../README.md.
// Script hooks: agent(), pipeline(), parallel(), phase(), log(), args.
// The script has NO filesystem access — actors write files, verifiers read
// directories, a committer subagent runs tools/commit-memory.mjs.

const A = args ?? {}

const DEFAULT_ACTOR_PROMPT = `You are the ACTOR Agent in an RSI wave. Produce a small,
complete deliverable for the topic using your file tools, inside the candidate
directory given to you. One deliverable + PROPOSAL.md (what and why). Keep it small
and concrete. Do not grade yourself.`

const DEFAULT_VERIFIER_PROMPT = `You are the VERIFIER Agent. Independently check the
candidate directory against the task. You may access files ONLY through the
restricted read channel and run probe commands ONLY inside a throwaway copy:
  - READ:    node __PROTO__/tools/verify-read.mjs --root <candidateDir> --path <rel>
             (also --list; any path outside the candidate dir is rejected, exit 2)
  - RUN:     node __PROTO__/tools/verify-run.mjs --candidate <candidateDir> --timeout 30 -- <cmd...>
             (executes inside a temporary COPY of the candidate, side effects are
             discarded afterwards — use it to confirm BEHAVIORAL claims like
             "the script really prints X / really exits 0")
Never read actor notes/transcripts, the memory area, or sibling candidates.
Read real file content; PASS requires direct evidence for every requirement.
Verdict PASS/FAIL/UNVERIFIED, score 0-100, requirement-by-requirement findings,
evidence file names, and — for behavioral claims — the verify-run exit_code/stdout you
observed.`

const DEFAULT_CURRICULUM_PROMPT = `You are the CURRICULUM Agent. From the wave
summary and memory commit count, choose next_wave (with a concrete next_topic
targeting observed weaknesses) or done (with reason). You never grade or edit
memory yourself.`

const actorPrompt = A.prompts?.actor ?? DEFAULT_ACTOR_PROMPT
const verifierPrompt = A.prompts?.verifier ?? DEFAULT_VERIFIER_PROMPT
const curriculumPrompt = A.prompts?.curriculum ?? DEFAULT_CURRICULUM_PROMPT

const root = A.root // absolute workspace root that contains the prototype, e.g. /root/workspace/deepseek-rsi-dev
if (!root) throw new Error('args.root is required (absolute path of the repo checkout)')
const proto = `${root}/examples/rsi-prototype`
const ws = `${proto}/rsi-workspace`
const commitRoot = `${ws}/commits`
const memoryDir = A.memoryDir ?? `${ws}/memory`
const maxWaves = A.maxWaves ?? 2
const actorCount = A.actorCount ?? 2
const waveSeedTopic = A.topic ?? 'Polish a short usage note: clear, correct, no filler'

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNVERIFIED'] },
    score: { type: 'number' },
    findings: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['verdict', 'score', 'findings'],
  additionalProperties: false,
}

const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['next_wave', 'done'] },
    next_topic: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['action', 'reason'],
  additionalProperties: false,
}

const waves = []
let topic = waveSeedTopic

phase('rsi-wave-loop')
log(`RSI wave loop: root=${root} maxWaves=${maxWaves} actorCount=${actorCount}`)

for (let wave = 1; wave <= maxWaves; wave++) {
  const waveLabel = `w${String(wave).padStart(3, '0')}`
  const waveDir = `${ws}/waves/${waveLabel}`

  // ---- explore: one parallel wave of actors, each in its own candidate dir
  phase(`wave-${wave}-explore`)
  const actorResults = await parallel(
    Array.from({ length: actorCount }, (_, i) => async () => {
      const dir = `${waveDir}/candidates/a${String(i + 1).padStart(2, '0')}`
      const res = await agent(
        `${actorPrompt}\n\nTOPIC (wave ${wave}): ${topic}\n` +
        `Your candidate directory (create it and write there): ${dir}\n` +
        `Previous committed memory (list first; reuse only what helps): ${commitRoot}\n` +
        `Shared read-only seed memory (optional, list first): ${memoryDir}`,
        { label: `actor-${wave}.${i + 1}`, phase: `wave-${wave}-explore` },
      )
      return {
        actor: `a${i + 1}`, dir, ok: typeof res === 'string' && res.length > 0,
        tail: typeof res === 'string' ? res.slice(-300) : null,
      }
    }),
  )
  const usable = actorResults.filter((r) => r.ok)
  log(`wave ${wave}: ${usable.length}/${actorResults.length} actors produced candidates`)

  // ---- verify: one isolated verifier per candidate; never sees sibling contexts
  phase(`wave-${wave}-verify`)
  const verified = []
  for (const r of usable) {
    const v = await agent(
      verifierPrompt.replaceAll('__PROTO__', proto) +
      `\n\nTASK (wave ${wave}): ${topic}\n` +
      `Inspect ONLY this candidate directory: ${r.dir}\n` +
      `Remember: reads through verify-read, behavioral checks through verify-run.`,
      { label: `verifier-${wave}.${r.actor}`, phase: `wave-${wave}-verify`, schema: VERDICT_SCHEMA },
    )
    verified.push({
      actor: r.actor, dir: r.dir,
      ...(v ?? { verdict: 'UNVERIFIED', score: 0, findings: 'verifier failed', evidence: '' }),
    })
  }

  // ---- commit: a committer subagent runs the hashed memory-commit tool
  phase(`wave-${wave}-commit`)
  const commits = []
  for (const c of verified) {
    const rep = await agent(
      `You are the MEMORY COMMITTER. Run this exact command with your shell tool and ` +
      `report its stdout and exit code. Do not modify files yourself.\n\n` +
      `node ${proto}/tools/commit-memory.mjs --mode generate ` +
      `--candidate ${c.dir} --wave ${wave} --actor ${c.actor} ` +
      `--verdict ${c.verdict} --score ${c.score} ` +
      `--findings "${String(c.findings).replace(/"/g, "'").slice(0, 300)}" ` +
      `--out ${commitRoot} --root ${ws}\n\n` +
      `If it fails, report stderr.`,
      { label: `committer-${wave}.${c.actor}`, phase: `wave-${wave}-commit` },
    )
    commits.push({ actor: c.actor, verdict: c.verdict, score: c.score, report: String(rep ?? '').slice(-400) })
  }

  // ---- curriculum: decide next wave or done
  phase(`wave-${wave}-curriculum`)
  const summary = verified
    .map((v) => `- ${v.actor}: ${v.verdict} score=${v.score} | ${String(v.findings).slice(0, 200)}`)
    .join('\n')
  const decision = await agent(
    `${curriculumPrompt}\n\nWAVE ${wave} SUMMARY:\n${summary}\n\nMEMORY: ${commits.length} commit(s) recorded under ${commitRoot}.`,
    { label: `curriculum-${wave}`, phase: `wave-${wave}-curriculum`, schema: DECISION_SCHEMA },
  )
  const dec = decision ?? { action: 'done', next_topic: '', reason: 'curriculum agent failed' }
  waves.push({ wave, topic, actors: actorResults, verified, commits, decision: dec })
  log(`wave ${wave}: curriculum -> ${dec.action} (${dec.reason})`)

  if (dec.action !== 'next_wave' || !dec.next_topic) break
  topic = dec.next_topic
}

return {
  ok: waves.length > 0,
  waves,
  finalDecision: waves.length ? waves[waves.length - 1].decision : null,
  memory: { commitRoot, memoryDir },
}