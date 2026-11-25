import { loadSettings, updateSettings } from '../../lib/settings';
import { loadUsage, today } from '../../lib/usage';
import { $ } from './dom';

const fmt = new Intl.NumberFormat();
const DAYS = 7;

/** The last 7 days, today first, with each day's totals across providers. */
export async function renderUsage() {
  const log = await loadUsage();
  const now = new Date();
  const todayKey = today(now);
  const total = { checks: 0, sent: 0, received: 0 };
  const rows: HTMLTableRowElement[] = [];
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12);
    const key = today(date);
    const day = { checks: 0, sent: 0, received: 0 };
    for (const u of Object.values(log[key] ?? {})) {
      day.checks += u.checks;
      day.sent += u.inputTokens;
      day.received += u.outputTokens;
    }
    total.checks += day.checks;
    total.sent += day.sent;
    total.received += day.received;
    const label = date.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    const tr = line(key === todayKey ? `${label} (today)` : label, day);
    if (key === todayKey) tr.className = 'today';
    rows.push(tr);
  }
  const table = $<HTMLTableElement>('usage-table');
  table.tBodies[0]?.replaceChildren(...rows);
  table.tFoot?.replaceChildren(line(`${DAYS} days`, total));
}

function line(label: string, n: { checks: number; sent: number; received: number }) {
  const tr = document.createElement('tr');
  const th = Object.assign(document.createElement('th'), { scope: 'row', textContent: label });
  tr.append(th);
  for (const v of [n.checks, n.sent, n.received]) {
    tr.append(Object.assign(document.createElement('td'), { textContent: fmt.format(v) }));
  }
  return tr;
}

export async function wireLimit() {
  const on = $<HTMLInputElement>('limit-on');
  const limit = $<HTMLInputElement>('limit');
  const { dailyLimit } = await loadSettings();
  on.checked = dailyLimit !== null;
  limit.disabled = !on.checked;
  if (dailyLimit !== null) limit.value = String(dailyLimit);
  const save = async () => {
    limit.disabled = !on.checked;
    const n = Math.floor(Number(limit.value));
    if (!(n >= 1)) return;
    await updateSettings((s) => ({ ...s, dailyLimit: on.checked ? n : null }));
  };
  on.addEventListener('change', () => void save());
  limit.addEventListener('change', () => void save());
}
