// Stockage local (localStorage) : tout reste dans le navigateur de l'étudiant.
const KEY = 'studyflow:v1';

const defaults = () => ({
  profile: { name: '' },
  subjects: [],
  docs: [],        // {id, subjectId, kind: 'cours'|'serie', name, text, createdAt, analysis, analysisMode}
  exercises: [],   // {id, docId, subjectId, num, title, statement, status, answer, hints[], feedback, solution}
  events: [],      // cours hebdomadaires {id, subjectId, day (0=dimanche), start 'HH:MM', end, room}
  deadlines: [],   // {id, subjectId, title, type: 'devoir'|'examen'|'autre', due 'YYYY-MM-DDTHH:MM', done}
  settings: { apiKey: '', model: 'claude-sonnet-5-5', notifications: false, leads: [60, 15], lang: 'fr' },
  notified: {},    // clés de rappels déjà envoyés
  activity: {},    // 'YYYY-MM-DD' -> nombre d'actions (pour la série de jours)
  plan: {},        // {trialStart, premiumUntil}
  focus: {},       // 'YYYY-MM-DD' -> minutes de concentration
});

// Anciennes versions : emojis → icônes
const LEGACY = { '🐍': 'code', '🗄️': 'database', '📐': 'sigma', '🌐': 'globe', '🧮': 'sigma', '⚛️': 'atom', '🧪': 'flask', '📖': 'book', '💻': 'cpu', '🧬': 'dna', '📊': 'chart', '🏛️': 'landmark', '🗣️': 'languages', '🎨': 'palette' };
function migrate(s) {
  for (const sub of s.subjects || []) if (!sub.icon) sub.icon = LEGACY[sub.emoji] || 'book';
  return s;
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults();
    const s = JSON.parse(raw);
    return migrate({ ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } });
  } catch {
    return defaults();
  }
}

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export function get() { return state; }

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alertQuota(e);
  }
  listeners.forEach((fn) => fn(state));
}

function alertQuota(e) {
  console.error(e);
  const t = document.getElementById('toasts');
  if (t) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = "⚠️ Espace de stockage plein : supprime d'anciens documents ou exporte une sauvegarde.";
    t.append(el);
    setTimeout(() => el.remove(), 8000);
  }
}

export function update(fn) {
  fn(state);
  save();
}

export function replaceAll(newState) {
  const d = defaults();
  state = migrate({ ...d, ...newState, settings: { ...d.settings, ...(newState.settings || {}) } });
  save();
}

export function reset() {
  state = defaults();
  save();
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function logActivity() {
  const k = dayKey(new Date());
  state.activity[k] = (state.activity[k] || 0) + 1;
}

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function streak() {
  let n = 0;
  const d = new Date();
  if (!state.activity[dayKey(d)]) d.setDate(d.getDate() - 1); // la série continue si on a travaillé hier
  while (state.activity[dayKey(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function subjectProgress(subjectId) {
  const ex = state.exercises.filter((e) => e.subjectId === subjectId);
  if (!ex.length) return null;
  const done = ex.filter((e) => e.status === 'done').length;
  return { done, total: ex.length, pct: Math.round((done / ex.length) * 100) };
}
