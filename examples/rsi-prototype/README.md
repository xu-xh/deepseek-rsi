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

## Isolation notes (W1 scope)

Verifier isolation is currently **prompt-level + directory staging** (the script
hands the verifier only its candidate path). Mechanical enforcement — fs-sandbox
path scoping, guard rules that forbid the verifier's tools from touching the
actor/memory areas, and snapshot/rollback for candidates — is the W2 hardening
item (see the integration report in
`/root/workspace/artifacts/rsiagent-dsh/rsia-dsh-report.html`).

## Branch protection

`master` is protected. Work on `feat/*` branches only; a local `pre-push` hook
refuses direct pushes to `master`/`main`. See
[`docs/BRANCH-PROTECTION.md`](docs/BRANCH-PROTECTION.md) — it includes the
GitHub-side branch rule settings to apply in the fork.