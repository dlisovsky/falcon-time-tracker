import { createApp } from './app.js';
import { openDatabase } from './db.js';
import { seedDemoData } from './seed.js';
import { createService } from './service.js';

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || 'data/timetracker.db';

const db = openDatabase(dbPath);
// Hosted demos run on ephemeral disks, so they can opt in to fictional data.
if (process.env.SEED_DEMO === 'true' && seedDemoData(db)) {
  console.log('Seeded fictional demo data');
}
const app = createApp(createService(db));

const server = app.listen(port, () => {
  console.log(`Time tracker listening on http://localhost:${port} (db: ${dbPath})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
