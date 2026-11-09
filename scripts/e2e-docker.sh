#!/usr/bin/env bash
# Run the Playwright suite in the official image for the pinned version, so screenshots are
# rendered by the same browser, fonts and OS libraries everywhere. Any CI job must use this image.
# Usage: scripts/e2e-docker.sh [playwright args...]   e.g.  scripts/e2e-docker.sh --update-snapshots
set -euo pipefail
IMAGE="mcr.microsoft.com/playwright:v1.56.1-noble"
node scripts/check-playwright-pin.mjs
exec docker run --rm --init --ipc=host -v "$PWD":/work -w /work -e CI=1 -e E2E_IN_DOCKER=1 "$IMAGE" npx playwright test e2e/visual.spec.ts "$@"
