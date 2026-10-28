import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { AppError, badRequest } from './errors.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function parseDate(value, name) {
  if (typeof value !== 'string' || value === '') throw badRequest(`"${name}" is required`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw badRequest(`"${name}" is not a valid date`);
  return ms;
}

export function createApp(service) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/employees', (_req, res) => {
    res.json(service.listEmployees());
  });

  app.post('/api/employees', (req, res) => {
    res.status(201).json(service.addEmployee(req.body?.name));
  });

  app.post('/api/employees/:id/timer/start', (req, res) => {
    res.status(201).json(service.startTimer(req.params.id, req.body?.description));
  });

  app.post('/api/employees/:id/timer/stop', (req, res) => {
    res.json(service.stopTimer(req.params.id));
  });

  // GET /api/report?from=ISO&to=ISO[&employeeId=1]
  app.get('/api/report', (req, res) => {
    const { employeeId } = req.query;
    res.json(
      service.report({
        from: parseDate(req.query.from, 'from'),
        to: parseDate(req.query.to, 'to'),
        employeeId: employeeId ? employeeId : null,
      }),
    );
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } });
  });

  app.use(express.static(publicDir));

  // Express 5 forwards rejected promises / thrown errors here.
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  return app;
}
