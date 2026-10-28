import { dateRangeToPeriod, formatDuration, presetRange } from './format.js';

const $ = (sel) => document.querySelector(sel);
const state = { employees: [] };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function showError(err) {
  const toast = $('#toast');
  toast.textContent = err.message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const fmtDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

/* ---------- Employees & timers ---------- */

async function loadEmployees() {
  state.employees = await api('/employees');
  renderEmployees();
  renderEmployeeFilter();
}

function renderEmployees() {
  const list = $('#employees');
  const template = $('#employee-template');
  list.replaceChildren();
  $('#employees-empty').hidden = state.employees.length > 0;

  for (const emp of state.employees) {
    const node = template.content.firstElementChild.cloneNode(true);
    const running = emp.activeEntry;
    node.dataset.id = emp.id;
    node.classList.toggle('running', Boolean(running));
    node.querySelector('.name').textContent = emp.name;

    const input = node.querySelector('.description');
    const startBtn = node.querySelector('.start');
    const stopBtn = node.querySelector('.stop');
    input.value = running ? running.description : '';
    input.disabled = Boolean(running);
    startBtn.hidden = Boolean(running);
    stopBtn.hidden = !running;

    node.querySelector('.timer').addEventListener('submit', async (e) => {
      e.preventDefault();
      startBtn.disabled = true;
      try {
        await api(`/employees/${emp.id}/timer/start`, { method: 'POST', body: { description: input.value } });
        await refreshAll();
      } catch (err) {
        showError(err);
        startBtn.disabled = false;
      }
    });
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      try {
        await api(`/employees/${emp.id}/timer/stop`, { method: 'POST' });
        await refreshAll();
      } catch (err) {
        showError(err);
        stopBtn.disabled = false;
      }
    });
    list.append(node);
  }
  tick();
}

function renderEmployeeFilter() {
  const select = $('#report-employee');
  const current = select.value;
  select.replaceChildren(new Option('All employees', ''));
  for (const emp of state.employees) select.append(new Option(emp.name, emp.id));
  select.value = state.employees.some((e) => String(e.id) === current) ? current : '';
}

// Updates the live "running for" counters once per second without re-rendering.
function tick() {
  const now = Date.now();
  for (const emp of state.employees) {
    const status = document.querySelector(`.employee[data-id="${emp.id}"] .status`);
    if (!status) continue;
    status.textContent = emp.activeEntry
      ? `● ${formatDuration(now - Date.parse(emp.activeEntry.startedAt))}`
      : 'idle';
  }
}

$('#add-employee').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#employee-name');
  try {
    await api('/employees', { method: 'POST', body: { name: input.value } });
    input.value = '';
    await refreshAll();
  } catch (err) {
    showError(err);
  }
});

/* ---------- Report ---------- */

function setRange({ from, to }) {
  $('#from').value = from;
  $('#to').value = to;
}

async function loadReport() {
  const from = $('#from').value;
  const to = $('#to').value;
  if (!from || !to) return;
  if (from > to) {
    showError(new Error('"From" date must not be after "To" date'));
    return;
  }
  const params = new URLSearchParams(dateRangeToPeriod(from, to));
  const employeeId = $('#report-employee').value;
  if (employeeId) params.set('employeeId', employeeId);
  renderReport(await api(`/report?${params}`));
}

function renderReport(report) {
  const container = $('#report');
  const withEntries = report.employees.filter((e) => e.entries.length > 0);

  const summary = `
    <div class="summary">
      <div><span class="muted">Total time</span><strong>${formatDuration(report.totalMs)}</strong></div>
      <div><span class="muted">Records</span><strong>${withEntries.reduce((n, e) => n + e.entries.length, 0)}</strong></div>
    </div>`;

  if (withEntries.length === 0) {
    container.innerHTML = `${summary}<div class="empty">No time recorded for this period.</div>`;
    return;
  }

  container.innerHTML = summary + report.employees.map((emp) => `
    <div class="group">
      <h3><span>${escapeHtml(emp.name)}</span><span class="num">${formatDuration(emp.totalMs)}</span></h3>
      ${emp.entries.length === 0 ? '<p class="muted">No records.</p>' : `
      <div class="table-wrap"><table>
        <thead><tr><th>Task</th><th>Start</th><th>End</th><th class="num">Duration</th></tr></thead>
        <tbody>${emp.entries.map((entry) => `
          <tr>
            <td>${escapeHtml(entry.description)}</td>
            <td>${fmtDateTime.format(new Date(entry.startedAt))}</td>
            <td>${entry.running ? '<span class="badge">running</span>' : fmtDateTime.format(new Date(entry.endedAt))}</td>
            <td class="num" title="Time inside the selected period">${formatDuration(entry.inPeriodMs)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`}
    </div>`).join('');
}

$('#report-form').addEventListener('submit', (e) => {
  e.preventDefault();
  loadReport().catch(showError);
});
$('#report-employee').addEventListener('change', () => loadReport().catch(showError));
for (const btn of document.querySelectorAll('[data-preset]')) {
  btn.addEventListener('click', () => {
    setRange(presetRange(btn.dataset.preset));
    loadReport().catch(showError);
  });
}

async function refreshAll() {
  await loadEmployees();
  await loadReport();
}

setRange(presetRange('week'));
refreshAll().catch(showError);
setInterval(tick, 1000);
// Keep report totals fresh while someone's timer is running.
setInterval(() => {
  if (state.employees.some((e) => e.activeEntry)) loadReport().catch(() => {});
}, 30_000);
