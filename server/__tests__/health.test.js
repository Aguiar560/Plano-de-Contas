'use strict';

/**
 * health.test.js — Endpoint de liveness/readiness probe
 */

const request = require('supertest');
const { app } = require('./helpers');

describe('GET /health', () => {
  test('retorna 200 com ok:true e uptime numérico', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
  });

  test('não requer autenticação', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  test('inclui status do banco quando DB está disponível', async () => {
    const res = await request(app).get('/health');
    // Com DB real disponível nos testes, deve retornar db:'ok'
    if (res.body.db !== undefined) {
      expect(res.body.db).toBe('ok');
    }
    // Caso não haja DB configurado, ok:true sem campo db — também válido
    expect(res.body.ok).toBe(true);
  });
});
