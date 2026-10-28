import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createService } from '../src/service.js';

describe('HTTP API', () => {
  let server, baseUrl, db;

  before(async () => {
    db = openDatabase(':memory:');
    server = createApp(createService(db)).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(() => { server.close(); db.close(); });

  async function call(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  }

  it('runs the main scenario end to end', async () => {
    const created = await call('POST', '/employees', { name: 'Test Person' });
    assert.equal(created.status, 201);
    const id = created.body.id;

    assert.equal((await call('POST', `/employees/${id}/timer/start`, { description: 'API test' })).status, 201);
    assert.equal((await call('POST', `/employees/${id}/timer/start`, { description: 'Again' })).status, 409);
    assert.equal((await call('POST', `/employees/${id}/timer/stop`)).status, 200);
    assert.equal((await call('POST', `/employees/${id}/timer/stop`)).status, 409);
    // restart after stopping
    assert.equal((await call('POST', `/employees/${id}/timer/start`, { description: 'Second run' })).status, 201);

    const from = new Date(Date.now() - 3_600_000).toISOString();
    const to = new Date(Date.now() + 3_600_000).toISOString();
    const report = await call('GET', `/report?from=${from}&to=${to}&employeeId=${id}`);
    assert.equal(report.status, 200);
    assert.deepEqual(report.body.employees[0].entries.map((e) => e.description), ['API test', 'Second run']);
  });

  it('returns an empty report for a period without records', async () => {
    const res = await call('GET', '/report?from=2000-01-01T00:00:00Z&to=2000-01-02T00:00:00Z');
    assert.equal(res.status, 200);
    assert.equal(res.body.totalMs, 0);
    assert.ok(res.body.employees.every((e) => e.entries.length === 0 && e.totalMs === 0));
  });

  it('returns structured validation errors', async () => {
    const noName = await call('POST', '/employees', {});
    assert.equal(noName.status, 400);
    assert.equal(noName.body.error.code, 'BAD_REQUEST');

    assert.equal((await call('GET', '/report?from=nope&to=2000-01-01')).status, 400);
    assert.equal((await call('GET', '/report')).status, 400);
    assert.equal((await call('POST', '/employees/9999/timer/start', { description: 'x' })).status, 404);
    assert.equal((await call('GET', '/unknown')).status, 404);
  });

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${baseUrl}/employees`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad',
    });
    assert.equal(res.status, 400);
  });
});
