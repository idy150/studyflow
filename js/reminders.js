// Rappels intelligents : cours qui approchent, échéances (devoirs, examens), exercices en retard.
import { get, save, dayKey } from './store.js';

export const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function subjectOf(id) {
  return get().subjects.find((s) => s.id === id) || { name: 'Matière supprimée', emoji: '📘', color: '#888' };
}

/** Prochaine occurrence (Date) d'un cours hebdomadaire, à partir de maintenant. */
export function nextOccurrence(ev, from = new Date()) {
  for (let add = 0; add <= 7; add++) {
    const d = new Date(from);
    d.setDate(d.getDate() + add);
    if (d.getDay() !== Number(ev.day)) continue;
    const [h, m] = ev.start.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    const [eh, em] = (ev.end || ev.start).split(':').map(Number);
    const end = new Date(d);
    end.setHours(eh, em, 0, 0);
    if (end > from) return { start: d, end };
  }
  return null;
}

export function todaysClasses(now = new Date()) {
  return get().events
    .filter((e) => Number(e.day) === now.getDay())
    .sort((a, b) => toMin(a.start) - toMin(b.start));
}

export function relTime(date, now = new Date()) {
  const diff = Math.round((date - now) / 60000);
  if (diff < 0) {
    const a = -diff;
    if (a < 60) return `il y a ${a} min`;
    if (a < 1440) return `il y a ${Math.round(a / 60)} h`;
    return `il y a ${Math.round(a / 1440)} j`;
  }
  if (diff < 1) return 'maintenant';
  if (diff < 60) return `dans ${diff} min`;
  if (diff < 1440) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return `dans ${h} h${m ? ' ' + String(m).padStart(2, '0') : ''}`;
  }
  const days = Math.round(diff / 1440);
  return days === 1 ? 'demain' : `dans ${days} jours`;
}

/** Liste triée des prochains événements (cours + échéances). */
export function upcoming(limit = 8, now = new Date()) {
  const s = get();
  const items = [];
  for (const ev of s.events) {
    const occ = nextOccurrence(ev, now);
    if (occ) items.push({ kind: 'cours', date: occ.start, end: occ.end, ev, subject: subjectOf(ev.subjectId) });
  }
  for (const dl of s.deadlines) {
    if (dl.done) continue;
    const date = new Date(dl.due);
    if (date > now - 86400000) items.push({ kind: dl.type, date, dl, subject: subjectOf(dl.subjectId) });
  }
  return items.sort((a, b) => a.date - b.date).slice(0, limit);
}

function pendingExercises(subjectId) {
  return get().exercises.filter((e) => e.subjectId === subjectId && e.status !== 'done');
}

function latestCourse(subjectId) {
  return get().docs.filter((d) => d.subjectId === subjectId && d.kind === 'cours').sort((a, b) => b.createdAt - a.createdAt)[0];
}

/** Construit le message contextuel d'un cours qui approche. */
export function classMessage(ev, start, now = new Date()) {
  const sub = subjectOf(ev.subjectId);
  const parts = [`🔔 Ton cours de ${sub.name} commence ${relTime(start, now)}${ev.room ? ` (${ev.room})` : ''}.`];
  const doc = latestCourse(ev.subjectId);
  if (doc) parts.push(`📚 Révise « ${doc.name} » avant le cours.`);
  const pend = pendingExercises(ev.subjectId);
  if (pend.length) parts.push(`📝 Tu as ${pend.length} exercice${pend.length > 1 ? 's' : ''} non terminé${pend.length > 1 ? 's' : ''} en ${sub.name}.`);
  return parts;
}

const DEADLINE_LEADS = [3 * 1440, 1440, 180]; // 3 jours, 1 jour, 3 heures

let notifyFn = () => {};
export function setNotifier(fn) {
  notifyFn = fn;
}

/** Vérifie s'il faut envoyer des rappels. Appelée toutes les 30 secondes. */
export function tick(now = new Date()) {
  const s = get();
  let changed = false;
  const mark = (k) => {
    s.notified[k] = now.getTime();
    changed = true;
  };

  // 1) Cours qui approchent
  const leads = [...(s.settings.leads || [60, 15])].map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  for (const ev of s.events) {
    const occ = nextOccurrence(ev, now);
    if (!occ) continue;
    const mins = (occ.start - now) / 60000;
    if (mins < -1) continue;
    const lead = leads.find((L) => mins <= L);
    if (lead === undefined) continue;
    const base = `c:${ev.id}:${dayKey(occ.start)}`;
    if (s.notified[`${base}:${lead}`]) continue;
    leads.filter((L) => L >= lead).forEach((L) => mark(`${base}:${L}`));
    const sub = subjectOf(ev.subjectId);
    notifyFn(`${sub.emoji} ${sub.name} · ${ev.start}`, classMessage(ev, occ.start, now).join('\n'));
  }

  // 2) Devoirs / examens
  for (const dl of s.deadlines) {
    if (dl.done) continue;
    const due = new Date(dl.due);
    const mins = (due - now) / 60000;
    if (mins < 0) continue;
    const lead = DEADLINE_LEADS.slice().sort((a, b) => a - b).find((L) => mins <= L);
    if (lead === undefined) continue;
    const base = `d:${dl.id}`;
    if (s.notified[`${base}:${lead}`]) continue;
    DEADLINE_LEADS.filter((L) => L >= lead).forEach((L) => mark(`${base}:${L}`));
    const sub = subjectOf(dl.subjectId);
    const icon = dl.type === 'examen' ? '⚠️' : '📝';
    const label = dl.type === 'examen' ? 'Examen' : dl.type === 'devoir' ? 'Devoir' : 'Échéance';
    const extra = dl.type === 'examen' ? 'Lance une révision : relis tes fiches et refais les exercices non terminés.' : 'Pense à le terminer à temps.';
    notifyFn(`${icon} ${label} de ${sub.name} ${relTime(due, now)}`, `${dl.title}\n${extra}`);
  }

  // 3) Résumé du matin (une fois par jour, à partir de 6 h)
  const today = dayKey(now);
  if (now.getHours() >= 6 && !s.notified[`m:${today}`]) {
    const cls = todaysClasses(now).filter((e) => toMin(e.end || e.start) > now.getHours() * 60 + now.getMinutes());
    mark(`m:${today}`);
    if (cls.length) {
      notifyFn(
        `☀️ Ton programme d'aujourd'hui`,
        cls.map((e) => `${e.start} · ${subjectOf(e.subjectId).name}`).join('\n'),
      );
    }
  }

  // Nettoyage des vieilles clés (> 10 jours)
  for (const [k, t] of Object.entries(s.notified)) {
    if (now.getTime() - t > 10 * 86400000) {
      delete s.notified[k];
      changed = true;
    }
  }
  if (changed) save();
}
