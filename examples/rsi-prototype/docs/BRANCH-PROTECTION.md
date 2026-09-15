# Branch protection (local + remote)

`master` is the **protected trunk** of this repository. All development happens
on feature branches; `master` never receives direct commits or direct pushes.

## Local enforcement (this checkout)

A `pre-push` git hook is installed at `.git/hooks/pre-push` and refuses any push
whose remote ref is `refs/heads/master` or `refs/heads/main`:

```sh
$ git push origin feat/rsi-w1-prototype   # allowed
$ git push origin master                  # REFUSED by local pre-push hook
```

Reinstall after cloning (hooks are not tracked by git):

```sh
npm run --silent 2>/dev/null; node scripts/install-protection-hook.mjs
# or manually: copy the hook script shown below into .git/hooks/pre-push and chmod +x
```

Hook script (identical to the installed one):

```sh
#!/bin/sh
PROTECTED="master main"
while read local_ref local_sha remote_ref remote_sha; do
  for p in $PROTECTED; do
    if [ "$remote_ref" = "refs/heads/$p" ]; then
      echo "pre-push: REFUSED direct push to protected branch '$p'." >&2
      exit 1
    fi
  done
done
exit 0
```

## Remote enforcement (GitHub, admin action — not performable from this box)

Protected branches are enforced server-side in the fork settings so that
`master` cannot be pushed to or force-updated even by members:

1. GitHub → Settings → Branches → **Add branch protection rule**.
2. Branch name pattern: `master` (and optionally `main`).
3. Check: **Require a pull request before merging** (with 1 approving review),
   **Require status checks to pass before merging**, and **Do not allow bypassing
   the above settings**.
4. Check: **Require linear history** and **Lock branch** (optional).
5. Optionally: **Restrict pushes** to `feat/*` patterns only.

## Workflow

- Create a branch: `git switch -c feat/<name>`
- Commit and push the branch: `git push -u origin feat/<name>`
- Open a PR into `master` and merge only after review/checks.

## Why

RSI (recursive self-improvement) touches learning state, memory commits, and
potentially the harness runtime itself. Keeping `master` clean means every
change is reviewable, revertible, and attributable before it reaches the trunk.