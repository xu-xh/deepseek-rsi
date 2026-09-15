# rsi-prototype — W1: DSH-native recursive self-improvement loop

W1 milestone prototype: a **DSH-native RSI loop** (workflow + subagents + goal +
filesystem) that mirrors RSIAgent's protocol invariants in miniature:

- **Actor wave** — parallel candidates for one topic, each in its own directory
  (never shared).
- **Isolated verifier** — one verifier subagent per candidate; it may read ONLY
  the candidate directory (never actor notes, never memory, never siblings).
- **Memory commit gate** — accepted candidates are copied into the memory area
  with a per-file sha256 manifest, atomically (tmp + rename), plus an
  append-only journal; a path guard refuses candidates that escape the workspace.
- **Curriculum** — a read-only subagent decides `next_wave` (with a concrete
  targeting topic) or `done`. Never grades or edits memory itself.

Design provenance: RSIAgent (AetherLabsAI/RSIAgent, Apache-2.0) — three-agent
protocol (Actor / Verifier / Curriculum), broad-then-deep waves, frozen-memory
reuse, "memory only changes at verified boundaries". This prototype keeps the
invariants and replaces the Python/VM machinery with DSH primitives.

## Layout

```text
examples/rsi-prototype/
  workflows/wave-rsi.body.js   # workflow tool script body (see meta.json)
  workflows/meta.json          # identity block for the workflow tool
  prompts/                     # canonical role prompts (actor/verifier/curriculum)
  lib/memory-lib.mjs           # memory-commit gate primitives
  tools/commit-memory.mjs      # CLI: generate | verify | hash
  tools/verify-read.mjs        # verifier restricted READ channel (containment)
  tools/verify-run.mjs         # verifier behavioral probe in throwaway copy
  tools/smoke.mjs              # no-LLM mechanical checks
  scripts/install-protection-hook.mjs
  docs/BRANCH-PROTECTION.md    # master is protected; feature branches only
  rsi-workspace/               # runtime state (git-ignored)
```

## Quick checks (no LLM, no credentials)

```sh
node examples/rsi-prototype/tools/smoke.mjs
```

Run from the repo root. Verifies: manifest generation, atomic copy, journal,
tamper detection, hash consistency, and both isolation path guards.

## Running the real wave (in a DSH session)

The prototype is driven from any DSH Web session with the `workflow` tool:

1. Read the script body: `examples/rsi-prototype/workflows/wave-rsi.body.js`
2. Call the `workflow` tool with:
   - `script` = that file's content (plain JS body),
   - `meta` = `examples/rsi-prototype/workflows/meta.json`,
   - `args` = e.g.

```json
{
  "root": "/path/to/deepseek-rsi-dev",
  "topic": "Polish a short usage note: clear, correct, no filler",
  "maxWaves": 2,
  "actorCount": 2
}
```

Optionally pass `prompts: { actor, verifier, curriculum }` loaded from
`prompts/*.md` to use the canonical role texts instead of the embedded defaults.

The script runs: one parallel actor wave -> isolated verifiers (structured
schema verdicts) -> committer subagents persist commits under
`rsi-workspace/commits/w<NNN>/<actor>/` with `MANIFEST.json` -> curriculum
decides the next topic or `done` -> loop.

### Goal integration (session-driven curriculum)

In a live DSH session the host agent (not the script) should own the curriculum
state with the goal tools: create one goal per learning run
(`create_goal`), advance it between waves (`update_goal` with phase/rounds),
and pause/resume across restarts. The script's built-in curriculum is the
self-contained fallback for headless runs.

## Isolation & behavioral verification (W2)

The verifier accesses the candidate through two mechanical channels instead of
raw filesystem tools:

- `tools/verify-read.mjs` — restricted READ: realpath containment, no symlink
  traversal, no write verbs. Any path outside the candidate's allowed root is
  rejected (`CONTAIN` → exit 2).
- `tools/verify-run.mjs` — behavioral probe: executes a command inside a
  **throwaway copy** of the candidate (fixed timeout), then discards the copy.
  Side effects can never leak into the candidate or memory ("lightweight
  rollback"); `timed_out` is reported distinctly from a failed exit code.

These make the verifier's *isolation boundary* and *behavioral grounding*
mechanically enforced at the tool layer. For deployments that can additionally
shape the verifier agent's tool surface, the recommended DSH-level composition is:
give the verifier subagent ONLY these two channels (plus the schema-constrained
report), enforced with DSH `sandbox`/`guard`/`fs-sandbox` — so the agent cannot
bypass the channels with other tools. That final layer is deployment config, not
prototype code.

## Goal budget wiring (session-driven curriculum)

In a live DSH session the host agent should cap cost with the goal tools:

```text
create_goal({ objective: "RSI run: <topic>", max_goal_rounds: <waveCap> })
update_goal({ phase: "wave-2", ... })   # advance between waves
update_goal({ action: "pause"|"complete"|"blocked" })
```

`max_goal_rounds` is the wave budget; the workflow script's `args.maxWaves` is the
in-loop bound, and the runtime's own `workflow` `maxTotalAgents` (caller-set) caps
subagent spend. Tokens are the real currency — set all three deliberately.

## Branch protection

`master` is protected. Work on `feat/*` branches only; a local `pre-push` hook
refuses direct pushes to `master`/`main`. See
[`docs/BRANCH-PROTECTION.md`](docs/BRANCH-PROTECTION.md) — it includes the
GitHub-side branch rule settings to apply in the fork.