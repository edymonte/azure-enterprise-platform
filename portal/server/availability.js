// Flexible availability, the two study tracks and a simple AWS counter.
//
// Nothing here is an obligation: minutes are ceilings, an empty day or week is
// valid, and no task is ever created to make up for a day that was not studied.
// The AWS course (SAA-C03) lives outside the portal; only the count is kept.
import { UserError } from './progress.js';

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = [
  { id: 'tranquilo', label: 'Dia tranquilo', minutes: 'até 120 min' },
  { id: 'normal', label: 'Dia normal', minutes: '60–90 min' },
  { id: 'exigente', label: 'Dia exigente', minutes: '15–30 min, opcional' },
  { id: 'sobrecarga', label: 'Dia de sobrecarga', minutes: 'descanso, sem penalidade' },
];

export function parseAvailability(raw) {
  if (!raw) return null;
  for (const k of ['vacationEnds', 'workStarts']) if (!DATE.test(raw[k] ?? '')) throw new Error(`schedule.json: availability.${k} must be YYYY-MM-DD`);
  for (const k of ['intensiveMinutes', 'weekdayMaxMinutes', 'saturdayMaxMinutes']) if (!Number.isInteger(raw[k]) || raw[k] <= 0 || raw[k] > 600) throw new Error(`schedule.json: availability.${k} must be a whole number of minutes`);
  const tracks = raw.tracks ?? [];
  if (tracks.some((t) => !t.id || !t.name || !Number.isInteger(t.share))) throw new Error('schedule.json: availability.tracks need id, name and share');
  if (tracks.length && tracks.reduce((n, t) => n + t.share, 0) !== 100) throw new Error('schedule.json: the track shares must add up to 100');
  const aws = raw.aws ?? null;
  if (aws && !(Number.isInteger(aws.done) && Number.isInteger(aws.total) && aws.total > 0 && aws.done >= 0 && aws.done <= aws.total)) throw new Error('schedule.json: availability.aws needs done <= total');
  return {
    vacationEnds: raw.vacationEnds,
    workStarts: raw.workStarts,
    intensiveMinutes: raw.intensiveMinutes,
    weekdayMaxMinutes: raw.weekdayMaxMinutes,
    saturdayMaxMinutes: raw.saturdayMaxMinutes,
    tracks,
    aws,
    horizonDays: raw.horizonDays ?? 60,
    note: typeof raw.note === 'string' ? raw.note : '',
  };
}

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const fmt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// What one calendar day looks like. Always optional, never a debt.
export function availabilityFor(cfg, dateIso) {
  if (!cfg) return null;
  const dow = parse(dateIso).getDay(); // 0 = Sunday
  const base = { date: dateIso, penalty: false, compensation: false, tiers: TIERS };
  if (dow === 0) return { ...base, kind: 'sunday', maxMinutes: 0, label: 'Domingo: descanso', message: 'Descanso. Nada é cobrado e nada se acumula.' };
  if (dateIso <= cfg.vacationEnds) {
    return { ...base, kind: 'vacation', maxMinutes: cfg.intensiveMinutes, label: `Férias até ${fmt(cfg.vacationEnds)}`, message: `Estudo intensivo possível, cerca de ${Math.floor(cfg.intensiveMinutes / 60)}h${String(cfg.intensiveMinutes % 60).padStart(2, '0')} por dia, conforme energia e disponibilidade. É um teto, não uma meta.` };
  }
  if (dow === 6) return { ...base, kind: 'saturday', maxMinutes: cfg.saturdayMaxMinutes, label: 'Sábado: prática complementar opcional', message: `Opcional, até ${cfg.saturdayMaxMinutes / 60} h. Pode ficar em branco.` };
  const transition = dateIso < cfg.workStarts;
  return {
    ...base,
    kind: 'weekday',
    maxMinutes: cfg.weekdayMaxMinutes,
    label: transition ? `Retorno ao projeto (rotina regular a partir de ${fmt(cfg.workStarts)})` : 'Dia útil',
    message: `Até ${cfg.weekdayMaxMinutes} minutos, e 120 não é obrigação nem meta mínima. Dia normal: 60–90. Dia exigente: 15–30 opcionais. Sobrecarga: descanso, sem penalidade.`,
  };
}

function weekStart(dateIso) {
  const d = parse(dateIso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return isoDate(d);
}

// Days of this week (Monday to Sunday) with something the learner recorded.
export function activeDays(blockRecords, aws, dateIso) {
  const start = weekStart(dateIso);
  const end = (() => { const d = parse(start); d.setDate(d.getDate() + 6); return isoDate(d); })();
  const stamps = [];
  for (const r of Object.values(blockRecords ?? {})) {
    for (const p of r.reviewPasses ?? []) stamps.push(p.at);
    for (const s of Object.values(r.steps ?? {})) if (s?.attemptAt) stamps.push(s.attemptAt);
    for (const t of [r.recall?.submittedAt, r.english?.at, r.feedback?.at]) if (t) stamps.push(t);
  }
  if (aws?.updatedAt) stamps.push(aws.updatedAt);
  const days = new Set(stamps.filter(Boolean).map((t) => isoDate(new Date(t))).filter((d) => d >= start && d <= end));
  return [...days].sort();
}

export function buildAvailability({ cfg, dateIso, blockRecords, awsRecord }) {
  if (!cfg) return null;
  const aws = awsRecord ?? (cfg.aws ? { course: cfg.aws.course ?? 'SAA-C03', done: cfg.aws.done, total: cfg.aws.total, updatedAt: null, reportedAt: cfg.aws.reportedAt ?? null } : null);
  const today = availabilityFor(cfg, dateIso);
  const days = activeDays(blockRecords, awsRecord, dateIso);
  const vacation = today.kind === 'vacation';
  return {
    today,
    tracks: cfg.tracks,
    week: {
      start: weekStart(dateIso),
      activeDays: days,
      goal: vacation
        ? 'Meta semanal flexível: o que a energia permitir, até cerca de 3h15 por dia.'
        : 'Meta semanal flexível: 3 a 4 sessões de 60–90 min, uma prioridade em cada. Semana leve ou vazia é válida; nada é compensado depois.',
    },
    aws: aws ? { ...aws, next: Math.min(aws.done + 1, aws.total), percent: Math.round((aws.done / aws.total) * 100) } : null,
    note: cfg.note,
  };
}

export function recordAws(store, body, cfg) {
  const prev = store.data.aws ?? cfg?.aws ?? {};
  const total = body.total === undefined ? prev.total : body.total;
  const done = body.done;
  if (!Number.isInteger(total) || total < 1 || total > 500) throw new UserError('"total" must be a whole number of lessons (1–500).');
  if (!Number.isInteger(done) || done < 0 || done > total) throw new UserError('"done" must be a whole number between 0 and the total.');
  store.data.aws = { course: prev.course ?? 'SAA-C03', done, total, updatedAt: new Date().toISOString() };
  store.save();
}
