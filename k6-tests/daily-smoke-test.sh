#!/bin/bash
# Daily smoke test - Every day at 6 AM

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
LOG_DIR="/home/abdum/services/monitoring-tool/k6-tests/logs"
mkdir -p $LOG_DIR

echo "[$TIMESTAMP] Starting DAILY smoke test..."

docker compose -f /home/abdum/services/monitoring-tool/docker-compose.yml exec -T k6 k6 run \
  --vus 5 \
  --duration 5m \
  /scripts/ai-assistant-auth-load-test.js \
  > $LOG_DIR/daily-test-$TIMESTAMP.log 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$TIMESTAMP] PASSED: Daily smoke test"
else
    echo "[$TIMESTAMP] FAILED: Daily smoke test"
fi

# Keep last 7 daily logs (1 week)
cd $LOG_DIR
ls -t daily-test-*.log | tail -n +8 | xargs rm -f 2>/dev/null