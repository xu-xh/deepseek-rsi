import { readFileSync } from 'node:fs';

// Read all of stdin as UTF-8 text.
const text = readFileSync(0, 'utf8');

// Strip a leading UTF-8 BOM if present, then normalize line endings.
const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

const entries = new Map();

for (const line of normalized.split('\n')) {
  if (line.trim() === '') continue; // skip empty and whitespace-only lines
  const eq = line.indexOf('=');
  const key = eq === -1 ? line : line.slice(0, eq);
  const value = eq === -1 ? '' : line.slice(eq + 1);
  entries.set(key, value); // duplicate keys: keep the last value
}

// Keys sorted lexicographically; JSON property order follows insertion order.
const sorted = Object.fromEntries([...entries.keys()].sort().map((k) => [k, entries.get(k)]));

process.stdout.write(JSON.stringify(sorted) + '\n');