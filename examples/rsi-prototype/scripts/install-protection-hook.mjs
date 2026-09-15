// install-protection-hook.mjs — installs the pre-push hook that refuses direct
// pushes to the protected master/main branches. Run from the repo root:
//   node examples/rsi-prototype/scripts/install-protection-hook.mjs
import process from 'node:process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const HOOK = `#!/bin/sh
# Local branch-protection: refuse direct pushes to the protected master branch.
# Remote branch protection (GitHub side) is configured separately in Settings.
PROTECTED="master main"
while read local_ref local_sha remote_ref remote_sha; do
  for p in $PROTECTED; do
    if [ "$remote_ref" = "refs/heads/$p" ]; then
      echo "pre-push: REFUSED direct push to protected branch '$p'." >&2
      echo "pre-push: work on a feature branch and merge via review/PR instead." >&2
      exit 1
    fi
  done
done
exit 0
`

const root = process.cwd()
const hooksDir = path.join(root, '.git', 'hooks')
const target = path.join(hooksDir, 'pre-push')
await fs.mkdir(hooksDir, { recursive: true })
await fs.writeFile(target, HOOK, { mode: 0o755 })
console.log(`installed pre-push hook: ${target}`)