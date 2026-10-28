import { badRequest, conflict, notFound } from './errors.js';

export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} is required`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} must be at most ${maxLength} characters`);
  }
  return text;
}

function toEntry(row, now) {
  const end = row.ended_at ?? now;
  return {
    id: row.id,
    employeeId: row.employee_id,
    description: row.description,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at).toISOString(),
    running: row.ended_at === null,
    durationMs: end - row.started_at,
  };
}

/**
 * Business logic for employees and time entries.
 * `clock` is injectable so tests can control time.
 */
export function createService(db, { clock = () => Date.now() } = {}) {
  const stmt = {
    insertEmployee: db.prepare('INSERT INTO employees (name, created_at) VALUES (?, ?)'),
    getEmployee: db.prepare('SELECT id, name, created_at FROM employees WHERE id = ?'),
    listEmployees: db.prepare('SELECT id, name, created_at FROM employees ORDER BY name COLLATE NOCASE, id'),
    runningEntry: db.prepare('SELECT * FROM time_entries WHERE employee_id = ? AND ended_at IS NULL'),
    allRunning: db.prepare('SELECT * FROM time_entries WHERE ended_at IS NULL'),
    insertEntry: db.prepare(
      'INSERT INTO time_entries (employee_id, description, started_at) VALUES (?, ?, ?)',
    ),
    stopEntry: db.prepare('UPDATE time_entries SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
    getEntry: db.prepare('SELECT * FROM time_entries WHERE id = ?'),
    // Entries that overlap [from, to): started before the period ends and
    // either still running or finished after the period starts.
    entriesInPeriod: db.prepare(`
      SELECT * FROM time_entries
      WHERE started_at < @to AND (ended_at IS NULL OR ended_at > @from)
        AND (@employeeId IS NULL OR employee_id = @employeeId)
      ORDER BY started_at, id
    `),
  };

  function parseId(id) {
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0) throw badRequest('Invalid employee id');
    return n;
  }

  function requireEmployee(id) {
    const employee = stmt.getEmployee.get(parseId(id));
    if (!employee) throw notFound(`Employee ${id} not found`);
    return employee;
  }

  function addEmployee(name) {
    const cleanName = requireText(name, 'Name', MAX_NAME_LENGTH);
    const createdAt = clock();
    const { lastInsertRowid } = stmt.insertEmployee.run(cleanName, createdAt);
    return { id: Number(lastInsertRowid), name: cleanName, activeEntry: null };
  }

  function listEmployees() {
    const now = clock();
    const running = new Map(stmt.allRunning.all().map((r) => [r.employee_id, toEntry(r, now)]));
    return stmt.listEmployees.all().map((e) => ({
      id: e.id,
      name: e.name,
      activeEntry: running.get(e.id) ?? null,
    }));
  }

  const startTimer = db.transaction((employeeId, description) => {
    const employee = requireEmployee(employeeId);
    const text = requireText(description, 'Task description', MAX_DESCRIPTION_LENGTH);
    if (stmt.runningEntry.get(employee.id)) {
      throw conflict(`Timer is already running for ${employee.name}`);
    }
    const now = clock();
    const { lastInsertRowid } = stmt.insertEntry.run(employee.id, text, now);
    return toEntry(stmt.getEntry.get(lastInsertRowid), now);
  });

  const stopTimer = db.transaction((employeeId) => {
    const employee = requireEmployee(employeeId);
    const running = stmt.runningEntry.get(employee.id);
    if (!running) throw conflict(`No running timer for ${employee.name}`);
    // Guard against clock skew producing a negative duration.
    const endedAt = Math.max(clock(), running.started_at);
    stmt.stopEntry.run(endedAt, running.id);
    return toEntry(stmt.getEntry.get(running.id), endedAt);
  });

  /**
   * Report for the half-open period [from, to). Durations are clipped to the
   * period, so an entry spanning midnight is split correctly between days.
   * Running timers count up to "now".
   */
  function report({ from, to, employeeId = null }) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      throw badRequest('Both "from" and "to" must be valid dates');
    }
    if (from >= to) throw badRequest('"from" must be earlier than "to"');
    const filterId = employeeId == null ? null : requireEmployee(employeeId).id;

    const now = clock();
    const rows = stmt.entriesInPeriod.all({ from, to, employeeId: filterId });
    const employees = filterId ? [stmt.getEmployee.get(filterId)] : stmt.listEmployees.all();

    const byEmployee = new Map(
      employees.map((e) => [e.id, { id: e.id, name: e.name, totalMs: 0, entries: [] }]),
    );
    for (const row of rows) {
      const group = byEmployee.get(row.employee_id);
      if (!group) continue;
      const end = row.ended_at ?? now;
      const inPeriodMs = Math.max(0, Math.min(end, to) - Math.max(row.started_at, from));
      group.entries.push({ ...toEntry(row, now), inPeriodMs });
      group.totalMs += inPeriodMs;
    }

    const result = [...byEmployee.values()];
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      totalMs: result.reduce((sum, e) => sum + e.totalMs, 0),
      employees: result,
    };
  }

  return { addEmployee, listEmployees, startTimer, stopTimer, report };
}
