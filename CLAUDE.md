# Working Rules for This Repository

These rules apply to every task in this project. If anything here conflicts with a direct instruction I give you, stop and ask which one wins.

---

## 1. Follow my instructions exactly

- Do what I asked: no more, no less.
- Do not expand scope. Don't refactor, rename, reformat, upgrade dependencies, or "improve" anything I didn't ask about. If you think something else should change, **suggest it and wait**. Don't just do it.
- Don't touch files unrelated to the task.
- If my instructions contradict each other, contradict this file, or seem to contradict what the code actually does, **stop and ask**.

## 2. Ask for clarification instead of guessing

Stop and ask **before acting** whenever:

- A request can reasonably be read more than one way.
- Information is missing (a file name, a value, expected behavior, which branch, which environment).
- There are two or more reasonable approaches with different trade-offs.
- A change would delete, overwrite, move, or rename files, or touch files I didn't mention.
- A test fails and the fix would change existing behavior.
- You find something unexpected: uncommitted changes you didn't make, tests already failing before you started, an unfamiliar branch, a diverged remote, missing config.

**How to ask:**
- Number each question and batch them in one message.
- For each one, say what you would do by default and why, so I can just reply "yes" or pick an option.
- Then **wait**. Don't proceed on assumptions.

## 3. Before starting any task

1. Check the state of the repo: `git status`, current branch, `git fetch`, and whether the local branch is behind/ahead/diverged from the remote.
2. Run a **baseline** of the checks in section 4 so you know what was already broken before you changed anything. Report any pre-existing failures.
3. Restate the task in 1–3 sentences and give a short plan. For anything non-trivial, wait for my OK before writing code.

## 4. Mandatory checks before ANY commit or push

Discover the project's own tooling first (`package.json` scripts, `Makefile`, `pyproject.toml`, CI config in `.github/workflows/`, etc.) and use the project's own commands. If a category below has no tooling in this project, **tell me and propose what to add**. Don't silently skip it and don't silently invent it.

Run all of the following. Every one must pass.

1. **Formatting:** formatter in check mode.
2. **Linting:** zero new errors; report new warnings.
3. **Type checking**, if the language/project supports it.
4. **Build:** the project must build cleanly; report any build warnings.
5. **Tests:**
   - Run the **full** test suite, not just tests for the files you touched.
   - Run it at least **twice**. If any test passes on one run and fails on another, report it as flaky. Do not ignore it.
   - Run integration / end-to-end tests if they exist.
   - New or changed behavior must have tests. Write them if missing; ask me if the expected behavior is unclear.
6. **Diagnostics:**
   - Check IDE / language-server diagnostics on every changed file if available: zero new errors, report warnings.
   - For web projects: load the page(s) affected and check the browser console for errors, failed network requests, and broken links/assets.
   - Compare against the baseline from step 3: nothing that passed before may fail now.
7. **Diff review:** read the full `git diff` (staged and unstaged) and confirm:
   - Only intended files changed.
   - No leftover debug code (`console.log`, `print`, `debugger`), commented-out code, or stray TODOs.
   - No secrets, API keys, tokens, `.env` files, credentials, or large/binary files.
8. **Security:** run the dependency audit if available (`npm audit`, `pip-audit`, etc.) and report anything new.
9. **Sync check:** immediately before pushing, `git fetch` again. If the remote moved, integrate the changes and **re-run all checks**.

## 5. Pushing rules

- **Never push without my explicit approval in the current conversation.** Show me the verification report (section 7), then ask: *"Ready to push `<branch>` to `<remote>`. Proceed?"* and wait for a yes.
- Never `git push --force` / `--force-with-lease` unless I explicitly say so.
- Never push directly to `main` / `master` unless I explicitly say so.
- Never use `--no-verify` or bypass hooks.
- Never amend, rebase, or rewrite commits that are already pushed without asking.
- Write clear commit messages describing *what* changed and *why*.
- After pushing, check CI status if you can (e.g. `gh run watch`) and report the result.

## 6. When something fails

- **Do not** weaken, skip, delete, or disable tests or lint rules to make them pass.
- **Do not** add `@ts-ignore`, `eslint-disable`, `# noqa`, `.skip`, or similar suppressions without asking me first.
- Find the root cause. If the real fix is outside the task's scope, stop and ask.
- If you can't fix it after a reasonable effort, stop and report what you tried, what you found, and what you suggest.

## 7. Honest reporting

- Never claim a check passed unless you actually ran it and saw the output.
- If a check couldn't run, say so and say why.
- Before any push, give me this report:

```
VERIFICATION REPORT
Branch: <branch>  →  Remote: <remote>/<branch>  (ahead X / behind Y)

| Check            | Command                 | Result | Notes |
|------------------|-------------------------|--------|-------|
| Format           | ...                     | ✅/❌   |       |
| Lint             | ...                     |        |       |
| Type check       | ...                     |        |       |
| Build            | ...                     |        |       |
| Tests (run 1)    | ...                     |        | X passed / Y failed |
| Tests (run 2)    | ...                     |        |       |
| E2E/integration  | ...                     |        |       |
| Diagnostics      | ...                     |        |       |
| Diff review      | git diff                |        | files changed: ... |
| Security audit   | ...                     |        |       |

Pre-existing failures (from baseline): ...
Skipped checks and why: ...
Open questions: ...
```
