# Proposal: `server.mjs` — dependency-free HTTP echo server (wave 1, candidate a02)

## What

Two files in this candidate directory:

- `server.mjs` — a single Node ESM file using only Node built-ins
  (`node:http`); no `package.json`, no npm dependencies.
- `PROPOSAL.md` — this document.

`server.mjs` starts an HTTP server bound to `127.0.0.1` with an
OS-assigned random port (port `0`), prints exactly one line
`LISTEN <port>` on stdout once listening, then serves the fixed
contract:

| Request        | Status | Body                                        |
| -------------- | ------ | ------------------------------------------- |
| `GET /`        | 200    | `HELLO-RSI` (exact)                         |
| `GET /health`  | 200    | `ok` (exact)                                |
| `POST /echo`   | 200    | `{"method":"POST","path":"/echo","body":"<raw request body verbatim>"}` |
| anything else  | 404    | `NOPE` (exact)                              |

The raw request body is accumulated as `Buffer` chunks and decoded
with UTF-8, so the echoed `body` field reproduces the request body
verbatim, including newlines and whitespace (e.g. `{"a":1}\n`).

## Why

The task is a mechanical acceptance probe: a grader (spawn, probe,
kill) must be able to start the server, read the `LISTEN` line to
discover the port, and check each route against an exact expected
status and body. The design keeps every such check trivially
satisfiable:

- Random-port listen (`server.listen(0, '127.0.0.1')`) avoids port
  collisions and keeps the address fixed to the loopback interface.
- Exact-body responses (`res.end('HELLO-RSI')`, etc.) with no
  trailing content; no compression, no redirects, no keep-alive
  complications.
- Method+path routing is explicit (`GET /`, `GET /health`,
  `POST /echo`), so a non-listed combination falls through to the
  404 `NOPE` branch — including e.g. `GET /missing`.
- Dependency-free (built-ins only) means zero install step and zero
  supply-chain surface: the grader can run `node server.mjs` in any
  environment where Node exists.

## Verification

Verified by direct execution before delivery (see run history):

- `node server.mjs` prints a single `LISTEN <port>` line and serves
  `GET /` -> 200 `HELLO-RSI`, `GET /health` -> 200 `ok`,
  `POST /echo` with body `{"a":1}\n` -> 200
  `{"method":"POST","path":"/echo","body":"{\"a\":1}\n"}`, and
  `GET /missing` -> 404 `NOPE`.
- Mechanical grader: `node grade.mjs --task http-echo
  --candidate <dir>` reports the passing checks.