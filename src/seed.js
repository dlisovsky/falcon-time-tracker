// Fictional demo data: a few employees with a week of past records.

const PEOPLE = ['Alice Fictional', 'Bob Example', 'Carol Sample', 'Dan Placeholder'];
const TASKS = [
  'Sprint planning', 'Code review', 'Fix login page layout', 'Write API docs',
  'Customer call (fictional)', 'Refactor report module', 'Design mockups', 'Deploy to staging',
];
const HOUR = 3_600_000;

/** Seeds only an empty database. Returns true if data was inserted. */
export function seedDemoData(db, now = new Date()) {
  if (db.prepare('SELECT COUNT(*) AS n FROM employees').get().n > 0) return false;

  const insertEmployee = db.prepare('INSERT INTO employees (name, created_at) VALUES (?, ?)');
  const insertEntry = db.prepare(
    'INSERT INTO time_entries (employee_id, description, started_at, ended_at) VALUES (?, ?, ?, ?)',
  );
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  db.transaction(() => {
    PEOPLE.forEach((name, i) => {
      const id = insertEmployee.run(name, now.getTime()).lastInsertRowid;
      for (let day = 1; day <= 7; day++) {
        const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day).getTime();
        let cursor = dayStart + (9 + (i % 2)) * HOUR;
        for (let k = 0; k < 2; k++) {
          const length = (1 + ((i + day + k) % 3)) * HOUR + ((i * 7 + day * 13) % 50) * 60_000;
          insertEntry.run(id, TASKS[(i + day + k) % TASKS.length], cursor, cursor + length);
          cursor += length + HOUR / 2;
        }
      }
    });
  })();
  return true;
}
