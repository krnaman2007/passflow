import request from 'supertest';
import app from '../src/app.js';

describe('API Tests', () => {
  it('GET /api/health should return status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.message).toBe('Backend server is running');
  });
});
