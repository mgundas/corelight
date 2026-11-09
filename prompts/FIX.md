# Fix instructions

You are fixing a specific problem reported by the human (described in the message) or by a review.

1. Re-read `docs/ARCHITECTURE.md` hard rules.
2. Reproduce or locate the cause first. Explain the root cause in one or two sentences before changing code. Do not guess-fix symptoms.
3. Make the smallest change that fixes the root cause. Do not refactor unrelated code.
4. If the bug is in logic that can be unit tested, add a test that fails before the fix and passes after.
5. Run `npm run check`.
6. Tell the human exactly how to verify the fix in the browser.
7. If the fix changes behavior described in the docs, update the docs. Add a line under "Known issues" in `docs/PROGRESS.md` if anything remains unresolved.
8. Commit: `fix: <short description>`.
