# T1 — commit-memory `--mode list` audit subcommand (Dsh real-dev evaluation)

## Background (real ticket)

Operations wants to audit memory commits — who committed what in which wave —
without digging through `commits/<actor>/` directories by hand. Today
`tools/commit-memory.mjs` only writes (generate) and verifies (verify/hash).

## Requirement

Extend `examples/rsi-prototype/tools/commit-memory.mjs` with a read-only
`--mode list` subcommand:

```
node tools/commit-memory.mjs --mode list --out <commitsRoot> [--json]
```

Behavior contract:

1. Identify commit directories under the commits root in BOTH layouts the
   codebase actually uses:
   - **actor-first** (`<root>/<actor>/<commitDir>/`): the acceptance fixture
     layout straightforwardly maps actor = first level, commit = second level.
   - **wave-first** (`<root>/<wNNN>/<actor>/`, what `commit-memory generate`
     actually writes via `lib/memory-lib.mjs`): detect a first-level name
     matching `/^w\d+$/` and traverse wave-first.
   In either layout, list only directories containing a readable
   `MANIFEST.json`; stray files, non-directories, symlinks and manifest-less
   dirs are ignored. The `actor` column prefers `manifest.actor` (when
   present and non-empty) over the layout dir name; `wave` always comes from
   the manifest.
2. Sort rows ascending by `(actor, wave)`: actor name string order, then
   numeric wave order.
3. Plain output: one row per commit, exactly
   `w<wave3> <actor> <commitDir> <tree12>` where `wave3` is the wave zero-padded
   to 3 digits (e.g. `w001`, matching the existing `waveLabel` convention) and
   `tree12` is the first 12 characters of the manifest's `tree_sha256`.
4. With `--json`: print one JSON array `[{wave, actor, commit, hash}]`
   (`wave` as a NUMBER, `hash` = first 12 chars) — nothing else on stdout.
5. Empty commits root: plain prints nothing (exit 0); `--json` prints `[]`
   (exit 0).
6. Missing `--out`: usage error to stderr, exit 1.
7. **Regression-free**: `generate`, `verify`, and `hash` modes behave exactly
   as before (the existing smoke suite must stay green).

Constraints: Node built-ins only; do not change `lib/memory-lib.mjs` semantics
or any other tool's behavior.

## Acceptance (the CI gate)

The suite in `tools/check-commit-list.mjs` is the grader (public, like any
real repository test — run it yourself before finishing):

```
node tools/check-commit-list.mjs     # must print CHECK-COMMIT-LIST OK
node tools/smoke.mjs                 # must print SMOKE OK (regression gate)
```

All 10 assertions must pass. Commit the changed `commit-memory.mjs` on your
branch when done.