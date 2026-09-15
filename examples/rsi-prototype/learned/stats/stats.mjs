#!/usr/bin/env node
// stats.mjs — zero-dependency baseline stats reader.
// Reads numbers from stdin (one per line). Emits a single JSON line.

import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf8');
const nums = [];
let sum = 0;

for (const line of input.split(/\r?\n/)) {
  if (line.trim() === '') continue; // skip empty / whitespace-only lines
  const n = Number(line);
  if (Number.isNaN(n)) continue; // ignore unparseable lines
  nums.push(n);
  sum += n;
}

if (nums.length === 0) {
  process.stdout.write('{"count":0}\n');
  process.exit(0);
}

nums.sort((a, b) => a - b);

const count = nums.length;
const mean = sum / count;
let median;
const mid = Math.floor(count / 2);
if (count % 2 === 1) {
  median = nums[mid];
} else {
  median = (nums[mid - 1] + nums[mid]) / 2;
}

process.stdout.write(
  JSON.stringify({
    count,
    sum,
    mean,
    median,
    min: nums[0],
    max: nums[count - 1],
  }) + '\n'
);