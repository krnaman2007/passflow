import http from 'k6/http';
import { check, sleep } from 'k6';

// k6 Load Test Configuration
export const options = {
  vus: 10, // 10 virtual users
  duration: '10s', // run for 10 seconds
};

export default function () {
  const baseUrl = __ENV.BACKEND_URL || 'http://localhost:5001';
  const url = `${baseUrl}/api/health`;
  const res = http.get(url);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has status ok': (r) => JSON.parse(r.body).status === 'ok',
  });

  sleep(0.5);
}
