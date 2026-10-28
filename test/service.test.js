import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { createService } from '../src/service.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-26T09:00:00Z');

/** Controllable clock for deterministic tests. */
function fakeClock(start = T0) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  clock.set = (ms) => { now = ms; };
  return clock;
}

describe('service', () => {
  let db, clock, svc;
  beforeEach(() => {
    db = openDatabase(':memory:');
    clock = fakeClock();
    svc = createService(db, { clock });
  });
  afterEach(() => db.close());

  it('adds employees with trimmed names and rejects invalid ones', () => {
    const emp = svc.addEmployee('  Alice Fictional  ');
    assert.equal(emp.name, 'Alice Fictional');
    assert.deepEqual(svc.listEmployees().map((e) => e.name), ['Alice Fictional']);
    assert.throws(() => svc.addEmployee('   '), { status: 400 });
    assert.throws(() => svc.addEmployee(undefined), { status: 400 });
    assert.throws(() => svc.addEmployee('x'.repeat(101)), { status: 400 });
  });

  it('starts and stops a timer and records the duration', () => {
    const { id } = svc.addEmployee('Alice');
    const started = svc.startTimer(id, 'Write docs');
    assert.equal(started.running, true);
    assert.equal(svc.listEmployees()[0].activeEntry.description, 'Write docs');

    clock.advance(90 * MIN);
    const stopped = svc.stopTimer(id);
    assert.equal(stopped.running, false);
    assert.equal(stopped.durationMs, 90 * MIN);
    assert.equal(svc.listEmployees()[0].activeEntry, null);
  });

  it('requires a task description to start', () => {
    const { id } = svc.addEmployee('Alice');
    assert.throws(() => svc.startTimer(id, ''), { status: 400 });
    assert.throws(() => svc.startTimer(id, 'x'.repeat(501)), { status: 400 });
  });

  it('does not allow two running timers for the same employee', () => {
    const { id } = svc.addEmployee('Alice');
    svc.startTimer(id, 'Task A');
    assert.throws(() => svc.startTimer(id, 'Task B'), { status: 409 });
  });

  it('rejects stopping when no timer is running', () => {
    const { id } = svc.addEmployee('Alice');
    assert.throws(() => svc.stopTimer(id), { status: 409 });
  });

  it('restarts the timer: start → stop → start creates a new separate record', () => {
    const { id } = svc.addEmployee('Alice');
    svc.startTimer(id, 'Morning task');
    clock.advance(1 * HOUR);
    svc.stopTimer(id);
    clock.advance(30 * MIN); // break, must not be counted
    const second = svc.startTimer(id, 'Afternoon task');
    clock.advance(2 * HOUR);
    svc.stopTimer(id);

    const report = svc.report({ from: T0, to: T0 + 24 * HOUR });
    const alice = report.employees[0];
    assert.equal(alice.entries.length, 2);
    assert.equal(alice.entries[1].id, second.id);
    assert.equal(alice.totalMs, 3 * HOUR);
  });

  it('timers of different employees are independent', () => {
    const a = svc.addEmployee('Alice');
    const b = svc.addEmployee('Bob');
    svc.startTimer(a.id, 'A task');
    svc.startTimer(b.id, 'B task');
    clock.advance(HOUR);
    svc.stopTimer(a.id);
    assert.equal(svc.listEmployees().find((e) => e.id === b.id).activeEntry.description, 'B task');
  });

  it('returns 404 for unknown employees', () => {
    assert.throws(() => svc.startTimer(999, 'Task'), { status: 404 });
    assert.throws(() => svc.stopTimer('abc'), { status: 400 });
  });

  describe('report', () => {
    it('returns an empty report when there is no data at all', () => {
      const report = svc.report({ from: T0, to: T0 + HOUR });
      assert.equal(report.totalMs, 0);
      assert.deepEqual(report.employees, []);
    });

    it('returns zero totals for employees without records in the period', () => {
      const { id } = svc.addEmployee('Alice');
      svc.startTimer(id, 'Old task');
      clock.advance(HOUR);
      svc.stopTimer(id);

      const nextWeek = T0 + 7 * 24 * HOUR;
      const report = svc.report({ from: nextWeek, to: nextWeek + 24 * HOUR });
      assert.equal(report.totalMs, 0);
      assert.equal(report.employees.length, 1);
      assert.deepEqual(report.employees[0].entries, []);
      assert.equal(report.employees[0].totalMs, 0);
    });

    it('sums time per employee and filters by employee', () => {
      const a = svc.addEmployee('Alice');
      const b = svc.addEmployee('Bob');
      svc.startTimer(a.id, 'A1'); clock.advance(HOUR); svc.stopTimer(a.id);
      svc.startTimer(b.id, 'B1'); clock.advance(2 * HOUR); svc.stopTimer(b.id);
      svc.startTimer(a.id, 'A2'); clock.advance(30 * MIN); svc.stopTimer(a.id);

      const all = svc.report({ from: T0, to: T0 + 24 * HOUR });
      const totals = Object.fromEntries(all.employees.map((e) => [e.name, e.totalMs]));
      assert.deepEqual(totals, { Alice: 90 * MIN, Bob: 2 * HOUR });
      assert.equal(all.totalMs, 3.5 * HOUR);

      const onlyBob = svc.report({ from: T0, to: T0 + 24 * HOUR, employeeId: b.id });
      assert.deepEqual(onlyBob.employees.map((e) => e.name), ['Bob']);
      assert.equal(onlyBob.totalMs, 2 * HOUR);
    });

    it('clips entries that cross the period boundary', () => {
      const { id } = svc.addEmployee('Night Owl');
      clock.set(Date.parse('2026-10-26T22:00:00Z'));
      svc.startTimer(id, 'Overnight deploy');
      clock.set(Date.parse('2026-10-27T02:00:00Z'));
      svc.stopTimer(id);

      const day1 = svc.report({ from: Date.parse('2026-10-26T00:00:00Z'), to: Date.parse('2026-10-27T00:00:00Z') });
      const day2 = svc.report({ from: Date.parse('2026-10-27T00:00:00Z'), to: Date.parse('2026-10-28T00:00:00Z') });
      assert.equal(day1.totalMs, 2 * HOUR);
      assert.equal(day2.totalMs, 2 * HOUR);
      assert.equal(day1.employees[0].entries[0].durationMs, 4 * HOUR);
    });

    it('counts a running timer up to now', () => {
      const { id } = svc.addEmployee('Alice');
      svc.startTimer(id, 'Still working');
      clock.advance(45 * MIN);
      const report = svc.report({ from: T0, to: T0 + 24 * HOUR });
      assert.equal(report.totalMs, 45 * MIN);
      assert.equal(report.employees[0].entries[0].running, true);
    });

    it('validates the period', () => {
      assert.throws(() => svc.report({ from: T0, to: T0 }), { status: 400 });
      assert.throws(() => svc.report({ from: NaN, to: T0 }), { status: 400 });
      assert.throws(() => svc.report({ from: T0, to: T0 + HOUR, employeeId: 42 }), { status: 404 });
    });
  });
});

describe('persistence across restarts', () => {
  let dir, dbFile;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timetracker-'));
    dbFile = path.join(dir, 'test.db');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps employees, records and a running timer after reopening the database', () => {
    const clock = fakeClock();
    let db = openDatabase(dbFile);
    let svc = createService(db, { clock });
    const { id } = svc.addEmployee('Alice');
    svc.startTimer(id, 'Before restart');
    clock.advance(HOUR);
    svc.stopTimer(id);
    svc.startTimer(id, 'Running during restart');
    db.close(); // simulate app shutdown

    clock.advance(30 * MIN);
    db = openDatabase(dbFile);
    svc = createService(db, { clock });

    const [alice] = svc.listEmployees();
    assert.equal(alice.name, 'Alice');
    assert.equal(alice.activeEntry.description, 'Running during restart');

    clock.advance(30 * MIN);
    svc.stopTimer(id); // the timer started before the restart can be stopped after it
    const report = svc.report({ from: T0, to: T0 + 24 * HOUR });
    assert.equal(report.employees[0].entries.length, 2);
    assert.equal(report.totalMs, 2 * HOUR);
    db.close();
  });
});

describe('demo seed', () => {
  it('seeds an empty database once and never touches existing data', async () => {
    const { seedDemoData } = await import('../src/seed.js');
    const db = openDatabase(':memory:');
    assert.equal(seedDemoData(db), true);
    assert.equal(seedDemoData(db), false);
    const svc = createService(db);
    assert.equal(svc.listEmployees().length, 4);
    db.close();
  });
});
