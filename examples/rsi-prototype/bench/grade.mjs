#!/usr/bin/env node
// bench/grade.mjs — uniform entry point for the mechanical graders.
// Usage: node grade.mjs --task <http-echo|parser|stats> --candidate <dir>
// Prints one JSON line {task, score, max, checks, stderr?}.
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promises as fs } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`)
  return i === -1 ? null : process.argv[i + 1]
}

const task = arg('task')
const candidate = arg('candidate')
if (!task || !candidate) {
  console.error('usage: node grade.mjs --task <name> --candidate <dir>')
  process.exit(2)
}
const gradePath = path.join(HERE, 'tasks', task, 'grade.mjs')
if (!(await fs.stat(gradePath).then(() => true, () => false))) {
  console.error(`unknown task: ${task}`)
  process.exit(2)
}
const { grade } = await import(gradePath)
const out = { task, candidate, ...(await grade(path.resolve(candidate))) }
process.stdout.write(JSON.stringify(out) + '\n')
process.exitCode = out.score === out.max ? 0 : 1