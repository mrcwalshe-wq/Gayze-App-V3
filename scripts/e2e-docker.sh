#!/usr/bin/env bash
# Run the Playwright suite in the official image for the version pinned in package.json,
# so screenshots are rendered by the same browser, fonts and OS libraries everywhere.
# Usage: scripts/e2e-docker.sh [playwright args...]   e.g.  scripts/e2e-docker.sh --update-snapshots
set -euo pipefail
VERSION="$(node -p "require('./package.json').devDependencies['@playwright/test'].replace(/^[^0-9]*/, '')")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
exec docker run --rm --init --ipc=host -v "$PWD":/work -w /work -e CI=1 "$IMAGE" npx playwright test e2e/visual.spec.ts "$@"
