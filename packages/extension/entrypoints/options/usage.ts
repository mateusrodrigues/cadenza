import { loadSettings, saveSettings } from '../../lib/settings';
import { loadUsage, today } from '../../lib/usage';
import { $ } from './dom';

const fmt = new Intl.NumberFormat();

export async function renderUsage() {
  const log = await loadUsage();
  const days = Object.keys(log).sort().reverse().slice(0, 7);
  const now = today();
  const rows = days.flatMap((day) =>
    Object.values(log[day] ?? {}).map((u) => {
      const tr = document.createElement('tr');
      const label = day === now ? 'Today' : new Date(`${day}T12:00`).toLocaleDateString();
      for (const text of [
        label,
        u.name,
        fmt.format(u.checks),
        fmt.format(u.inputTokens),
        fmt.format(u.outputTokens),
      ]) {
        tr.append(Object.assign(document.createElement('td'), { textContent: text }));
      }
      return tr;
    }),
  );
  $('usage-table')
    .querySelector('tbody')
    ?.replaceChildren(...rows);
  $('usage-table').hidden = rows.length === 0;
  $('usage-empty').hidden = rows.length > 0;
}

export async function wireLimit() {
  const on = $<HTMLInputElement>('limit-on');
  const limit = $<HTMLInputElement>('limit');
  const { dailyLimit } = await loadSettings();
  on.checked = dailyLimit !== null;
  if (dailyLimit !== null) limit.value = String(dailyLimit);
  const save = async () => {
    const n = Math.floor(Number(limit.value));
    if (!(n >= 1)) return;
    const s = await loadSettings();
    await saveSettings({ ...s, dailyLimit: on.checked ? n : null });
  };
  on.addEventListener('change', () => void save());
  limit.addEventListener('change', () => void save());
}
