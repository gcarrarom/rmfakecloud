# Releasing

Releases are manual and use one version source: the first version heading in `CHANGELOG.md`.

1. Add the next release heading to `CHANGELOG.md`, for example `# 0.0.46`.
2. Commit and push that change to `master`.
3. Open GitHub Actions and run **Release** with `version` set to `0.0.46`.

The workflow refuses to run when the requested version does not match the first changelog heading or when its Git tag already exists. It creates exactly that tag and GitHub release, then builds the binaries, Helm chart, and container from that exact tag. It does not calculate or increment versions automatically.
