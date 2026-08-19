# Agent Instructions

## Releases

Use the repository's automatic release workflow. A push to `master` is the release trigger; do not run a release tool locally, create a tag manually, or push a tag directly.

1. Read `docs/release.md` and `.github/workflows/release.yml` before changing release files.
2. Update `CHANGELOG.md` with the release notes while preserving the repository's numbered-heading format.
3. Commit and push the intended changes to `master`.
4. Watch the automatically triggered workflow and confirm the created tag, GitHub release, binaries, Helm chart, and container all use the same version.

The workflow uses `release-it` to calculate the next version from the latest Git tag, create the release commit and tag, publish the GitHub release, and then build the binaries, Helm chart, and container from that exact tag. Do not restore a manual dispatch trigger or add a competing version source.

Do not rewrite or delete historical release tags without explicit user approval.
