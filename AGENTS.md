# Agent Instructions

## Releases

Use the repository release workflow. Do not invent a version, run a release tool locally, create a tag manually, or push a tag directly.

1. Read `docs/release.md` and `.github/workflows/release.yml` before changing release files.
2. Put the intended release version in the first version heading of `CHANGELOG.md`.
3. Commit and push the changelog change to `master`.
4. Dispatch the workflow with the same version, for example:

   `gh workflow run release.yml --ref master -f version=0.0.46`

5. Watch the run and confirm the created tag, GitHub release, binaries, Helm chart, and container all use that version.

The workflow is deliberately manual. Normal pushes must not create releases. It validates semantic version format, matches the first changelog heading, rejects existing tags, creates the exact requested tag, and builds from that tag. Never restore a push trigger or automatic version incrementing.

A code commit pushed to `master` is not a release. For every requested release, do not stop after pushing code or the changelog: dispatch `release.yml`, monitor its jobs, and verify the remote tag, GitHub release, release assets, Helm chart, and both container tags (`latest` and the numeric release version).

If GitHub CLI authentication is unavailable, stop after preparing and pushing the changelog commit and tell the user that the workflow must be dispatched by an authenticated user.

Do not rewrite or delete historical release tags without explicit user approval.
