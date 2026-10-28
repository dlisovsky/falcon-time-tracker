import { it } from 'node:test';
import assert from 'node:assert/strict';
import { dateRangeToPeriod, formatDuration, presetRange } from '../public/format.js';

it('formats durations as h:mm:ss', () => {
  assert.equal(formatDuration(0), '0:00:00');
  assert.equal(formatDuration(3_723_000), '1:02:03');
  assert.equal(formatDuration(-5), '0:00:00');
  assert.equal(formatDuration(30 * 3_600_000), '30:00:00');
});

it('turns an inclusive date range into a half-open period covering whole local days', () => {
  const { from, to } = dateRangeToPeriod('2026-10-26', '2026-10-26');
  assert.equal(Date.parse(to) - Date.parse(from), 24 * 3_600_000);
  assert.equal(new Date(from).getHours(), 0);
});

it('builds preset ranges with Monday as week start', () => {
  const wednesday = new Date(2026, 9, 28, 15, 0); // Wed 28 Oct 2026
  assert.deepEqual(presetRange('today', wednesday), { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual(presetRange('week', wednesday), { from: '2026-10-26', to: '2026-10-28' });
  assert.deepEqual(presetRange('month', wednesday), { from: '2026-10-01', to: '2026-10-28' });
  const sunday = new Date(2026, 10, 1);
  assert.deepEqual(presetRange('week', sunday), { from: '2026-10-26', to: '2026-11-01' });
});
