import http from 'k6/http';
import { check, sleep } from 'k6';
import encoding from 'k6/encoding';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Warm up
    { duration: '3m', target: 20 },   // Sustained load
    { duration: '1m', target: 30 },   // Spike
    { duration: '2m', target: 30 },   // Sustained spike
    { duration: '1m', target: 0 },    // Ramp down
  ],
  
  thresholds: {
    // Baseline from smoke tests (5 VUs, May 2026): p95 ~8.2s, error rate 0%
    // Prometheus k6-alerts.yml fires when p95 > 15s or error rate > 10%
    'http_req_duration': ['p(95)<12000'],
    'http_req_failed': ['rate<0.15'],
  },
};

const DOMAIN = __ENV.MONITORING_DOMAIN || 'localhost';
const LOGIN_URL = `https://${DOMAIN}/login`;
const QUERY_URL = `https://${DOMAIN}:5053/query`;

// Login credentials
const LOGIN_EMAIL = __ENV.K6_LOGIN_EMAIL;
const LOGIN_PASSWORD = __ENV.K6_LOGIN_PASSWORD;

// Query variations (like your Locust)
const QUERIES = [
  "what is rejuve bio?",
  "hello?",
  "tell me about longevity",
  "what is aging?",
  "explain biomarkers"
];

let accessToken = null;

export function setup() {
  console.log('\n[INFO] Attempting login...\n');
  
  // Login request
  const loginData = {
    email: LOGIN_EMAIL,
    password: LOGIN_PASSWORD
  };
  
  const loginResponse = http.post(LOGIN_URL, loginData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': `https://${DOMAIN}`,
      'Referer': `https://${DOMAIN}/dashboard`,
    },
    redirects: 0,  // Don't follow redirects automatically
  });
  
  console.log(`Login response status: ${loginResponse.status}`);
  
  // Extract session cookie
  const cookies = loginResponse.cookies;
  let sessionCookie = null;
  
  for (let cookieName in cookies) {
    if (cookieName === '_session') {
      sessionCookie = cookies[cookieName][0].value;
      break;
    }
  }
  
  if (!sessionCookie) {
    console.log('[ERROR] No session cookie found');
    return { token: null };
  }
  
  console.log('[INFO] Session cookie found, extracting token...');
  
  // Decode session cookie to extract access token
  try {
    // URL decode
    const decodedCookie = decodeURIComponent(sessionCookie);
    
    // Split by dot and get payload part
    const parts = decodedCookie.split('.');
    const payloadPart = parts[0];
    
    // Add padding if needed
    const padding = '='.repeat((4 - (payloadPart.length % 4)) % 4);
    const paddedPayload = payloadPart + padding;
    
    // Base64 decode
    const decoded = encoding.b64decode(paddedPayload, 'rawurl');
    const decodedStr = String.fromCharCode.apply(null, new Uint8Array(decoded));
    
    // Parse JSON
    const data = JSON.parse(decodedStr);
    const token = data.user?.access_token;
    
    if (token) {
      console.log(`[INFO] Token extracted successfully (length: ${token.length})\n`);
      return { token: token };
    } else {
      console.log('[ERROR] No access_token in decoded data\n');
      return { token: null };
    }
  } catch (e) {
    console.log(`[ERROR] Token extraction failed: ${e}\n`);
    return { token: null };
  }
}

export default function(data) {
  if (!data.token) {
    console.log('[WARN] No token available, skipping iteration');
    sleep(1);
    return;
  }
  
  // Pick random query
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  
  // Make query request
  const queryPayload = `query=${encodeURIComponent(query)}`;
  
  const queryResponse = http.post(QUERY_URL, queryPayload, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer ${data.token}`,
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': `https://${DOMAIN}`,
      'Referer': `https://${DOMAIN}/dashboard`,
    },
  });
  
  const success = check(queryResponse, {
    'query status is 200': (r) => r.status === 200,
    'query has response': (r) => r.body && r.body.length > 0,
    'query response time < 5s': (r) => r.timings.duration < 5000,
  });
  
  if (success) {
    console.log(`[INFO] Query success: "${query.substring(0, 30)}..." (${queryResponse.timings.duration.toFixed(0)}ms)`);
  } else {
    console.log(`[ERROR] Query failed: "${query.substring(0, 30)}..." (Status: ${queryResponse.status})`);
  }
  
  // Wait between requests (like Locust wait_time between 5-15 seconds)
  sleep(Math.random() * 10 + 5);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  
  let promMetrics = '# k6 authenticated load test metrics\n';
  
  // Extract metrics safely
  if (metrics.http_reqs && metrics.http_reqs.values) {
    promMetrics += `k6_http_reqs_total ${metrics.http_reqs.values.count || 0}\n`;
    promMetrics += `k6_http_reqs_rate ${metrics.http_reqs.values.rate || 0}\n`;
  }
  
  if (metrics.http_req_duration && metrics.http_req_duration.values) {
    promMetrics += `k6_http_req_duration_avg_ms ${metrics.http_req_duration.values.avg || 0}\n`;
    promMetrics += `k6_http_req_duration_p95_ms ${metrics.http_req_duration.values['p(95)'] || 0}\n`;
    promMetrics += `k6_http_req_duration_p99_ms ${metrics.http_req_duration.values['p(99)'] || 0}\n`;
  }
  
  if (metrics.vus_max && metrics.vus_max.values) {
    promMetrics += `k6_vus_max ${metrics.vus_max.values.max || 0}\n`;
  }
  
  if (metrics.checks && metrics.checks.values) {
    const successRate = (metrics.checks.values.rate || 0) * 100;
    promMetrics += `k6_query_success_rate ${successRate}\n`;
  }
  
  if (metrics.http_req_failed && metrics.http_req_failed.values) {
    const errorRate = (metrics.http_req_failed.values.rate || 0) * 100;
    promMetrics += `k6_error_rate ${errorRate}\n`;
  }
  
  // Push to pushgateway
  const pushUrl = 'http://pushgateway:9091/metrics/job/k6_auth_load_test';
  const response = http.post(pushUrl, promMetrics);
  
  if (response.status === 200 || response.status === 202) {
    console.log('\n[INFO] Metrics pushed to Pushgateway successfully\n');
  }
  
  // Print summary
  console.log('\n========================================');
  console.log('  K6 Authenticated Load Test Summary');
  console.log('========================================');
  if (metrics.http_reqs) {
    console.log(`Total Requests: ${metrics.http_reqs.values.count || 0}`);
    console.log(`Request Rate: ${(metrics.http_reqs.values.rate || 0).toFixed(2)} req/s`);
  }
  if (metrics.http_req_duration) {
    console.log(`Avg Response: ${(metrics.http_req_duration.values.avg || 0).toFixed(2)} ms`);
    console.log(`p95 Response: ${(metrics.http_req_duration.values['p(95)'] || 0).toFixed(2)} ms`);
  }
  if (metrics.checks) {
    console.log(`Query Success Rate: ${((metrics.checks.values.rate || 0) * 100).toFixed(2)}%`);
  }
  if (metrics.http_req_failed) {
    console.log(`Error Rate: ${((metrics.http_req_failed.values.rate || 0) * 100).toFixed(2)}%`);
  }
  console.log('========================================\n');
  
  return {
    'stdout': '',
  };
}