#!/usr/bin/env bash
# Stability proof: N consecutive full visual runs (all viewports) in the pinned Docker image, comparing against
# the committed baselines. Each run's summary is appended to e2e/stability.log (untracked). Resumable: if the
# process is killed, run it again and it continues after the last logged run.
# Usage: scripts/e2e-stability.sh [N=10]
set -uo pipefail
N="${1:-10}"
LOG=e2e/stability.log
touch "$LOG"
if ! docker info >/dev/null 2>&1; then
  nohup dockerd > /tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
DONE=$(grep -c '^RUN ' "$LOG" || true)
for i in $(seq $((DONE + 1)) "$N"); do
  OUT=$(scripts/e2e-docker.sh 2>&1 | sed 's/\x1b\[[0-9;]*m//g')
  SUMMARY=$(echo "$OUT" | grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky)' | tr -s ' ' | tr '\n' ';')
  FAILS=$(echo "$OUT" | grep -E '^\s+✘' | sed 's/^ *//' | tr '\n' '|')
  echo "RUN $i/$N $(date -u +%FT%TZ) ${SUMMARY} ${FAILS:+FAILED: $FAILS}" >> "$LOG"
done
echo "DONE $N runs $(date -u +%FT%TZ)" >> "$LOG"
