import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '2m', target: 10 },
    { duration: '1m', target: 25 },
    { duration: '2m', target: 25 },
    { duration: '1m', target: 0 },
  ],
  
  thresholds: {
    'http_req_duration': ['p(95)<3000'],
    'http_req_failed': ['rate<0.60'],  // Allow auth failures
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5003';
const PUSHGATEWAY = 'http://pushgateway:9091';

export default function() {
  const health = http.get(`${BASE_URL}/`);
  check(health, {
    'health is 200': (r) => r.status === 200,
    'health has content': (r) => r.body.includes('health check'),
  });
  
  sleep(1);
  
  const faq = http.get(`${BASE_URL}/faq`);
  check(faq, {
    'faq responds': (r) => r.status !== 0,
  });
  
  sleep(2);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  let promMetrics = '# k6 load test metrics\n';
  
  // Safely extract metrics with null checks
  if (metrics.http_reqs && metrics.http_reqs.values) {
    const count = metrics.http_reqs.values.count || 0;
    const rate = metrics.http_reqs.values.rate || 0;
    promMetrics += `k6_http_reqs_total ${count}\n`;
    promMetrics += `k6_http_reqs_rate ${rate}\n`;
  }
  
  if (metrics.http_req_duration && metrics.http_req_duration.values) {
    const avg = metrics.http_req_duration.values.avg || 0;
    const p95 = metrics.http_req_duration.values['p(95)'] || 0;
    const p99 = metrics.http_req_duration.values['p(99)'] || 0;
    promMetrics += `k6_http_req_duration_avg_ms ${avg}\n`;
    promMetrics += `k6_http_req_duration_p95_ms ${p95}\n`;
    promMetrics += `k6_http_req_duration_p99_ms ${p99}\n`;
  }
  
  if (metrics.vus_max && metrics.vus_max.values) {
    const max = metrics.vus_max.values.max || 0;
    promMetrics += `k6_vus_max ${max}\n`;
  }
  
  if (metrics.checks && metrics.checks.values) {
    const rate = metrics.checks.values.rate || 0;
    const successRate = rate * 100;
    promMetrics += `k6_checks_success_rate ${successRate}\n`;
  }
  
  // Push to pushgateway
  const pushUrl = 'http://pushgateway:9091/metrics/job/k6_load_test';
  const response = http.post(pushUrl, promMetrics);
  
  if (response.status === 200 || response.status === 202) {
    console.log('\n[INFO] Metrics pushed to Pushgateway successfully\n');
  } else {
    console.log(`\n[WARN] Pushgateway returned status ${response.status}\n`);
  }
  
  // Print summary
  console.log('\n========================================');
  console.log('  K6 Load Test Summary');
  console.log('========================================');
  if (metrics.http_reqs) {
    console.log(`Total Requests: ${metrics.http_reqs.values.count || 0}`);
    console.log(`Request Rate: ${metrics.http_reqs.values.rate || 0} req/s`);
  }
  if (metrics.http_req_duration) {
    console.log(`Avg Response: ${metrics.http_req_duration.values.avg || 0} ms`);
    console.log(`p95 Response: ${metrics.http_req_duration.values['p(95)'] || 0} ms`);
  }
  if (metrics.checks) {
    console.log(`Check Success: ${(metrics.checks.values.rate * 100) || 0}%`);
  }
  console.log('========================================\n');
  
  return {
    'stdout': '',
  };
}