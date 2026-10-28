// Usage: npm run seed   (respects DB_PATH; does nothing if employees exist)
import { openDatabase } from '../src/db.js';
import { seedDemoData } from '../src/seed.js';

const dbPath = process.env.DB_PATH || 'data/timetracker.db';
const db = openDatabase(dbPath);
console.log(seedDemoData(db) ? `Seeded fictional demo data into ${dbPath}` : 'Database not empty, skipping seed.');
db.close();
