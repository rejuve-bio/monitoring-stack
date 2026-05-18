#!/bin/bash
# Weekly comprehensive load test - Sundays at 2 AM

TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
LOG_DIR="/home/abdum/services/monitoring-tool/k6-tests/logs"
mkdir -p $LOG_DIR

echo "[$TIMESTAMP] Starting WEEKLY comprehensive load test..."

docker compose -f /home/abdum/services/monitoring-tool/docker-compose.yml exec -T k6 k6 run \
  /scripts/ai-assistant-auth-load-test.js \
  > $LOG_DIR/weekly-test-$TIMESTAMP.log 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$TIMESTAMP] PASSED: Weekly load test"
else
    echo "[$TIMESTAMP] FAILED: Weekly load test - exit code $EXIT_CODE"
    # Send alert (optional)
fi

# Keep last 4 weekly logs (1 month)
cd $LOG_DIR
ls -t weekly-test-*.log | tail -n +5 | xargs rm -f 2>/dev/null