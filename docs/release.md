# Releasing

Releases are automatic. A push to `master` triggers `release-it`, which calculates the next patch version from the latest Git tag, creates the release commit and tag, and publishes the GitHub release.

1. Add the release notes to `CHANGELOG.md` using the repository's numbered-heading format.
2. Commit and push the intended changes to `master`.
3. Watch the automatically triggered **Release** workflow.
4. Verify the tag, GitHub release assets, Helm chart, and container tags (`latest` and the numeric version).

The release workflow uses `.release-it.json` and must remain the only release mechanism. Do not dispatch it manually, create tags locally, or manually bump Helm versions. The build and container jobs consume the tag created by `release-it`; the container publishes both `latest` and the numeric release tag.
