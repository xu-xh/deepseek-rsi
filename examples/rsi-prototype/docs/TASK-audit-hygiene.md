# T2 — verify-read / verify-run: no audit side effects without `--audit` (Dsh real-dev evaluation, ticket 2)

## Background (real defect, found during T1 eval)

`tools/verify-read.mjs` and `tools/verify-run.mjs` compute the audit target as

```
const auditFile = argv[argv.indexOf('--audit') + 1]
```

`argv` is `process.argv.slice(2)`. When `--audit` is absent, `indexOf` is `-1`, so
the expression reads `argv[0]` — the literal string of the first CLI argument
(`--root`, `--candidate`, `/some/abs/path`...). That value is truthy, so every
bare run **appends an audit JSONL row to a CWD file whose name is that literal
argument**. Observed fallout: running the smoke suite from the prototype dir
litters `--candidate` and `--root` files in the CWD; any other consumer that
forgets `--audit` silently writes junk into its working directory.

## Requirement

Modify `examples/rsi-prototype/tools/verify-read.mjs` and
`examples/rsi-prototype/tools/verify-run.mjs` so that:

1. **Without `--audit`:** the tool performs its normal function (read/run,
   stdout JSON, exit codes) and **creates zero files** (no audit file, no
   side effects). The full run must be side-effect free in the CWD.
2. **With `--audit <file>`:** behavior is unchanged — each read/denied/run
   event appends exactly one JSONL row to `<file>` (`verify-read` rows carry
   `tool:'verify-read'` and `ok`; `verify-run` rows carry `tool:'verify-run'`
   and `cmd`).
3. The literal `--root` / `--candidate` named audit files must never appear.

Constraints: Node built-ins only; do not change containment, timeout, or
rollback semantics; the full smoke suite must stay green.

## Acceptance (the CI gate)

Public suite `tools/check-audit-hygiene.mjs` (8 assertions):

```
node tools/check-audit-hygiene.mjs  # must print CHECK-AUDIT-HYGIENE OK
node tools/smoke.mjs                # must print SMOKE OK (regression gate)
```

Commit the two fixed tools on your branch when done.