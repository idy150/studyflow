import * as store from './store.js';
import * as AI from './ai.js';
import * as Plan from './plan.js';
import { CONFIG, cloudEnabled } from './config.js';
import * as Cloud from './cloud.js';
import { ic, badge, SUBJECT_ICONS, guessIcon } from './icons.js';
import { extractText, localAnalysis, localSplitExercises } from './analyze.js';
import { DAYS, upcoming, todaysClasses, relTime, subjectOf, tick, setNotifier, classMessage, DEADLINE_TYPES } from './reminders.js';

const S = () => store.get();
/** Lien pour activer l'IA : connexion (mode comptes) ou clé (mode simple). */
const aiHref = () => (cloudEnabled() ? '#/compte' : '#/parametres');
const aiCta = () => (cloudEnabled() ? 'Se connecter' : "Activer l'IA");
const aiWhere = () => (cloudEnabled() ? `<a href="#/compte">connecte-toi</a> (gratuit)` : `ajoute ta clé dans <a href="#/parametres">Paramètres</a>`);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

// ---------- Utilitaires d'affichage ----------
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Mini-rendu Markdown sûr (le texte est échappé avant mise en forme). */
function md(src = '') {
  const blocks = [];
  let text = String(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  text = esc(text);
  const inline = (t) =>
    t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1<i>$2</i>');
  const out = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (list !== type) {
        if (list) out.push(`</${list}>`);
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
    const hd = line.match(/^(#{1,4})\s+(.*)$/);
    if (hd) out.push(`<h3>${inline(hd[2])}</h3>`);
    else if (/^\u0000\d+\u0000$/.test(line.trim())) out.push(line.trim());
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return `<div class="md">${out.join('\n').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i])}</div>`;
}

function toast(title, body = '', ms = 7000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.title = 'Clique pour fermer';
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<div class="small" style="white-space:pre-line">${esc(body)}</div>` : ''}`;
  el.onclick = () => el.remove();
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function notify(title, body) {
  toast(title, body, 12000);
  if (S().settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {}
  }
}
setNotifier(notify);

function modal(html, bind) {
  const dlg = $('#modal');
  $('#modal-body').innerHTML = html;
  dlg.showModal();
  $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
  bind?.(dlg);
}

/** Bouton en état « en cours » pendant une action ; les autres boutons de la page sont bloqués. */
async function busy(btn, fn, label = 'Patiente…') {
  const html = btn.innerHTML;
  const others = $$('#app .btn:not(:disabled)').filter((b) => b !== btn);
  btn.disabled = true;
  others.forEach((b) => (b.disabled = true));
  btn.innerHTML = `<span class="spinner"></span> ${label}`;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast('Oups', e.message || String(e));
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = html;
    }
    others.forEach((b) => b.isConnected && (b.disabled = false));
  }
}

const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const COLORS = ['#6c4cf5', '#3aa6e0', '#15936b', '#d98a1c', '#e0577a', '#16131f', '#8d6bd8', '#2f7fb8'];
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function subjectOptions(selected) {
  return S().subjects.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function emptyState(icon, text, action = '') {
  return `<div class="empty">${badge({ icon, color: '#6c4cf5' }, 56)}<p>${text}</p>${action}</div>`;
}

const needSubjects = () => emptyState('book', "Ajoute d'abord une matière.", `<a class="btn primary" href="#/matieres">${ic('plus', 18)} Créer une matière</a>`);

/** Compte à rebours lisible pour une échéance. */
function countdown(date, now = new Date()) {
  const diff = date - now;
  if (diff < 0) return { big: '!', small: 'retard', cls: 'late' };
  const h = diff / 3600000;
  if (h < 24) return { big: `${Math.max(1, Math.round(h))}h`, small: 'restantes', cls: 'soon' };
  const d = Math.ceil(h / 24);
  return { big: `J-${d}`, small: d === 1 ? 'demain' : `${d} jours`, cls: d <= 3 ? 'soon' : '' };
}

function deadlineCards(dls, { withSubject = true, limit } = {}) {
  if (!dls.length) return emptyState('checkCircle', 'Aucune échéance. Ajoute tes devoirs, TP, TD et examens pour ne rien oublier.');
  const now = new Date();
  return dls.slice(0, limit).map((d) => {
    const due = new Date(d.due);
    const t = DEADLINE_TYPES[d.type] || DEADLINE_TYPES.autre;
    const c = d.done ? { big: ic('check', 22), small: 'fait', cls: 'done' } : countdown(due, now);
    const sub = subjectOf(d.subjectId);
    return `<div class="deadline ${c.cls}">
      <input type="checkbox" class="check" data-dl-done="${d.id}" ${d.done ? 'checked' : ''} title="Marquer comme fait" />
      <div class="countdown"><b>${c.big}</b><span>${c.small}</span></div>
      <div class="grow"><div class="row" style="gap:.4rem"><span class="pill ${d.type === 'examen' ? 'danger' : d.type === 'tp' || d.type === 'td' ? 'violet' : ''}">${ic(t.icon, 13)} ${t.label}</span>${withSubject ? `<span class="small muted">${esc(sub.name)}</span>` : ''}</div>
        <b>${esc(d.title)}</b><div class="small muted">${fmtDate(due)} à ${fmtTime(due)}</div></div>
      <button class="btn ghost icon" data-dl-del="${d.id}" title="Supprimer">${ic('trash', 18)}</button></div>`;
  }).join('');
}

function bindDeadlines(root = app) {
  $$('[data-dl-done]', root).forEach((c) => (c.onchange = () => {
    store.update((s) => {
      s.deadlines.find((d) => d.id === c.dataset.dlDone).done = c.checked;
      store.logActivity();
    });
    if (c.checked) toast('Bravo, une tâche de moins !');
    render();
  }));
  $$('[data-dl-del]', root).forEach((b) => (b.onclick = () => {
    if (!confirm('Supprimer cette échéance ?')) return;
    store.update((s) => (s.deadlines = s.deadlines.filter((d) => d.id !== b.dataset.dlDel)));
    render();
  }));
}

const sortedDeadlines = (filter = () => true) =>
  [...S().deadlines].filter(filter).sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));

// ---------- Minuteur de concentration (Pomodoro) ----------
const focus = { endAt: Number(localStorage.getItem('sf:focusEnd')) || 0, minutes: 25 };

function focusRemaining() {
  return Math.max(0, focus.endAt - Date.now());
}

function startFocus(min) {
  focus.minutes = min;
  focus.endAt = Date.now() + min * 60000;
  localStorage.setItem('sf:focusEnd', focus.endAt);
  localStorage.setItem('sf:focusMin', min);
  render();
}

function stopFocus(completed) {
  const min = Number(localStorage.getItem('sf:focusMin')) || focus.minutes;
  const elapsed = completed ? min : Math.round((min * 60000 - focusRemaining()) / 60000);
  focus.endAt = 0;
  localStorage.removeItem('sf:focusEnd');
  if (elapsed > 0) {
    store.update((s) => {
      const k = store.dayKey(new Date());
      s.focus[k] = (s.focus[k] || 0) + elapsed;
      store.logActivity();
    });
  }
  if (completed) notify('Séance terminée !', `${min} minutes de concentration. Fais une pause de 5 minutes.`);
  render();
}

function focusTick() {
  if (!focus.endAt) return;
  const left = focusRemaining();
  const el = $('#focus-time');
  if (el) el.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  if (left <= 0) stopFocus(true);
}

// ---------- Navigation ----------
const NAV = [
  ['dashboard', '#/', 'home', 'Tableau de bord', 'Accueil'],
  ['matieres', '#/matieres', 'book', 'Matières', 'Matières'],
  ['planning', '#/planning', 'calendar', 'Emploi du temps', 'Planning'],
  ['echeances', '#/echeances', 'clock', 'Échéances', 'Échéances'],
  ['premium', '#/premium', 'crown', 'Premium', 'Premium'],
  ...(cloudEnabled() ? [['compte', '#/compte', 'user', 'Mon compte', 'Compte']] : []),
  ['parametres', '#/parametres', 'settings', 'Paramètres', 'Réglages'],
];
$('#nav').innerHTML = NAV.map(([k, href, icon, label, short]) => `<a href="${href}" data-nav="${k}" class="${k === 'premium' ? 'nav-premium' : ''}">${ic(icon, 21)}<span class="long">${label}</span><span class="short">${short}</span></a>`).join('');
$('#logo').innerHTML = ic('cap', 22);

// ---------- Premium : boutons communs ----------
const minPrice = () => {
  const p = [...CONFIG.plans].sort((a, b) => a.days - b.days)[0];
  return `${p.price} ${CONFIG.currency} / ${p.label}`;
};

function trialCta(st) {
  if (st.kind === 'guest') return `<a class="btn ai lg" href="#/compte">${ic('user', 18)} Créer mon compte gratuit</a><p class="small muted">L'essai gratuit de ${CONFIG.trialDays} jours commence après l'inscription.</p>`;
  if (st.kind === 'free') return `<button class="btn ai lg" id="trial">${ic('sparkles', 18)} Essayer gratuitement ${CONFIG.trialDays} jours</button>`;
  if (st.kind === 'expired') return `<p><span class="pill danger">Ton essai gratuit est terminé</span></p><a class="btn ai lg" href="#/premium">${ic('crown', 18)} Passer à Premium</a>`;
  return '';
}

function bindTrial() {
  const b = $('#trial');
  if (b) b.onclick = () => busy(b, async () => {
    await Plan.startTrial();
    toast('Essai Premium activé', `${CONFIG.trialDays} jours pour générer tes TP et TD. Ouvre un cours puis l'onglet « TP / TD corrigés ».`);
    render();
  }, 'Activation…');
}

// ---------- Vues ----------
const views = {};

views.dashboard = () => {
  const s = S();
  const now = new Date();
  if (!s.profile.name) {
    app.innerHTML = `
      <div class="card" style="max-width:560px;margin:3rem auto;text-align:center;padding:2.5rem">
        <span class="logo" style="width:68px;height:68px;margin:0 auto 1rem;border-radius:20px">${ic('cap', 36)}</span>
        <h1>Bienvenue sur StudyFlow</h1>
        <p class="muted">Ton assistant d'étude : résumés de cours, TP et TD corrigés, emploi du temps, devoirs et rappels intelligents.</p>
        <form id="f-name" class="row" style="justify-content:center;margin-top:1.25rem">
          <input name="name" placeholder="Ton prénom" required style="max-width:240px" autofocus />
          <button class="btn primary">Commencer ${ic('right', 18)}</button>
        </form>
        <p class="small muted" style="margin-top:1.25rem">Gratuit, sans compte. Tes données restent dans ton navigateur.</p>
      </div>`;
    $('#f-name').onsubmit = (e) => {
      e.preventDefault();
      store.update((st) => (st.profile.name = new FormData(e.target).get('name').trim()));
      render();
    };
    return;
  }

  const hour = now.getHours();
  const hello = hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  const today = todaysClasses(now);
  const nowMin = hour * 60 + now.getMinutes();
  const pending = s.exercises.filter((e) => e.status !== 'done');
  const streak = store.streak();
  const doneCount = s.exercises.filter((e) => e.status === 'done').length;
  const focusToday = s.focus[store.dayKey(now)] || 0;
  const openDl = sortedDeadlines((d) => !d.done);
  const urgentDl = openDl.filter((d) => new Date(d.due) - now < 3 * 86400000).length;
  const nextClass = upcoming(20, now).find((i) => i.kind === 'cours');

  // Conseil intelligent selon le prochain cours
  let tip = '';
  if (nextClass && nextClass.date - now < 3 * 3600000) {
    const lines = [`Ton cours de <b>${esc(nextClass.subject.name)}</b> commence ${relTime(nextClass.date, now)}.`];
    const doc = s.docs.filter((d) => d.subjectId === nextClass.ev.subjectId && d.kind === 'cours').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (doc) lines.push(`Révise <a href="#/doc/${doc.id}">${esc(doc.name)}</a> pendant 15 minutes avant.`);
    const p = pending.filter((e) => e.subjectId === nextClass.ev.subjectId);
    if (p.length) lines.push(`${p.length} exercice(s) non terminé(s) : <a href="#/exo/${p[0].id}">continuer</a>.`);
    tip = `<div class="banner violet">${ic('bulb', 22)}<div>${lines.join('<br>')}</div></div>`;
  }

  const st = Plan.status();
  const running = focus.endAt > Date.now();

  app.innerHTML = `
    <div class="hero">
      <div class="row spread">
        <div><h1>${hello} ${esc(s.profile.name)}</h1>
          <div class="muted">${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${today.length ? `${today.length} cours aujourd'hui` : "pas de cours aujourd'hui"}${urgentDl ? ` · <b style="color:#fff">${urgentDl} échéance(s) dans moins de 3 jours</b>` : ''}</div></div>
        ${nextClass ? `<div style="text-align:right"><div class="muted small">Prochain cours</div><div style="font-size:1.3rem;font-weight:800">${esc(nextClass.subject.name)}</div><span class="pill" style="background:rgba(255,255,255,.15);color:#fff">${ic('clock', 13)} ${relTime(nextClass.date, now)}</span></div>` : ''}
      </div>
    </div>
    ${tip}
    ${cloudEnabled() && !Cloud.user() ? `<div class="banner violet">${ic('user', 22)}<span class="grow">Crée ton compte gratuit pour débloquer l'IA : résumés détaillés, corrections, indices et ${CONFIG.trialDays} jours d'essai Premium.</span><a class="btn sm ai" href="#/compte/inscription">Créer mon compte</a></div>` : ''}
    ${!s.settings.notifications ? `<div class="banner">${ic('bell', 22)}<span class="grow">Active les notifications pour être prévenu avant tes cours et tes devoirs.</span><button class="btn sm primary" id="enable-notif">Activer</button></div>` : ''}
    ${st.kind === 'trial' ? `<div class="banner violet">${ic('crown', 22)}<span class="grow">Essai Premium : encore <b>${st.daysLeft} jour${st.daysLeft > 1 ? 's' : ''}</b> pour générer des TP et TD corrigés.</span><a class="btn sm ai" href="#/premium">Voir l'offre</a></div>` : ''}

    <div class="grid grid-4" style="margin-bottom:1.1rem">
      ${[['flame', streak, `jour${streak > 1 ? 's' : ''} de suite`, '#e07a1c'], ['checkCircle', doneCount, 'exercices réussis', '#15936b'], ['timer', `${focusToday}<small style="font-size:1rem"> min</small>`, 'concentré aujourd’hui', '#3aa6e0'], ['clock', openDl.length, 'échéances à venir', '#6c4cf5']]
        .map(([i, v, l, c]) => `<div class="card stat-card" style="margin:0">${badge({ icon: i, color: c }, 48)}<div><div class="stat">${v}</div><div class="small muted">${l}</div></div></div>`).join('')}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2>${ic('calendar')} Aujourd'hui</h2>
        ${today.length ? `<ul class="list">${today.map((e) => {
          const sub = subjectOf(e.subjectId);
          const a = toMin(e.start), b = toMin(e.end || e.start);
          const state = nowMin >= b ? '<span class="pill">terminé</span>' : nowMin >= a ? '<span class="pill ok">en cours</span>' : '';
          return `<li><span class="time">${e.start}</span>${badge(sub, 36)}<span class="grow"><b>${esc(sub.name)}</b>${e.room ? `<div class="small muted">${esc(e.room)}</div>` : ''}</span>${state}</li>`;
        }).join('')}</ul>` : emptyState('calendar', `Pas de cours aujourd'hui.`, s.events.length ? '' : `<a class="btn primary" href="#/planning">${ic('plus', 18)} Ajouter mon emploi du temps</a>`)}
      </div>
      <div class="card">
        <div class="row spread"><h2>${ic('clock')} Échéances</h2><a class="btn sm" href="#/echeances">Tout voir</a></div>
        ${deadlineCards(openDl, { limit: 4 })}
      </div>
      <div class="card">
        <h2>${ic('chart')} Ta progression</h2>
        ${s.subjects.length ? s.subjects.map((sub) => {
          const p = store.subjectProgress(sub.id);
          return `<div style="margin-bottom:.9rem"><div class="row spread small" style="margin-bottom:.3rem"><span class="row" style="gap:.5rem">${badge(sub, 28)} <b>${esc(sub.name)}</b></span><span class="muted">${p ? `${p.done}/${p.total} · ${p.pct}%` : 'aucun exercice'}</span></div>
            <div class="progress" style="--c:${sub.color}"><div style="width:${p ? p.pct : 0}%"></div></div></div>`;
        }).join('') : needSubjects()}
      </div>
      <div class="card dark">
        <h2 style="color:#fff">${ic('timer')} Séance de concentration</h2>
        ${running
          ? `<div class="timer" id="focus-time">--:--</div><p class="muted small" style="text-align:center">Range ton téléphone, on travaille !</p><div class="row" style="justify-content:center"><button class="btn" id="focus-stop">${ic('pause', 18)} Arrêter</button></div>`
          : `<p class="muted small">Travaille sans distraction, puis fais une pause. Les minutes sont comptées dans ta journée.</p>
             <div class="row">${[25, 45, 60].map((m) => `<button class="btn ${m === 25 ? 'ai' : ''}" data-focus="${m}">${ic('play', 16)} ${m} min</button>`).join('')}</div>`}
        ${pending.length ? `<h3 style="color:#fff">À terminer</h3><ul class="list">${pending.slice(0, 3).map((e) => `<li style="border-color:#2b2738"><span class="grow">${esc(e.title)} <span class="small muted">· ${esc(subjectOf(e.subjectId).name)}</span></span><a class="btn sm" href="#/exo/${e.id}">Continuer</a></li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  $('#enable-notif')?.addEventListener('click', enableNotifications);
  $$('[data-focus]').forEach((b) => (b.onclick = () => startFocus(Number(b.dataset.focus))));
  $('#focus-stop')?.addEventListener('click', () => stopFocus(false));
  focusTick();
};

async function enableNotifications() {
  if (!('Notification' in window)) return toast('Ton navigateur ne gère pas les notifications', 'Les rappels s’afficheront dans la page.');
  const perm = await Notification.requestPermission();
  store.update((s) => (s.settings.notifications = perm === 'granted'));
  toast(perm === 'granted' ? 'Notifications activées' : 'Notifications refusées', perm === 'granted' ? 'Garde un onglet StudyFlow ouvert pour recevoir les rappels.' : 'Tu peux les réactiver dans les réglages du navigateur.');
  render();
}

views.matieres = () => {
  const s = S();
  app.innerHTML = `
    <div class="header row spread"><div><h1>Mes matières</h1><div class="muted">Ouvre une matière pour déposer tes cours, tes séries et tes devoirs.</div></div>
      <button class="btn primary" id="add-sub">${ic('plus', 18)} Nouvelle matière</button></div>
    ${s.subjects.length ? `<div class="grid grid-3">${s.subjects.map((sub) => {
      const nc = s.docs.filter((d) => d.subjectId === sub.id && d.kind === 'cours').length;
      const ne = s.exercises.filter((e) => e.subjectId === sub.id).length;
      const nd = s.deadlines.filter((d) => d.subjectId === sub.id && !d.done).length;
      const p = store.subjectProgress(sub.id);
      return `<a class="card subject-card" style="--c:${sub.color}" href="#/matiere/${sub.id}">
        ${badge(sub, 54)}<h2 style="margin:.8rem 0 .3rem">${esc(sub.name)}</h2>
        <div class="row small muted" style="gap:.9rem"><span>${ic('file', 15)} ${nc} cours</span><span>${ic('pencil', 15)} ${ne} exercices</span>${nd ? `<span>${ic('clock', 15)} ${nd}</span>` : ''}</div>
        <div class="progress" style="margin-top:.9rem;--c:${sub.color}"><div style="width:${p ? p.pct : 0}%"></div></div></a>`;
    }).join('')}</div>` : `<div class="card">${emptyState('book', "Aucune matière pour l'instant. Exemples : Python, Mathématiques, Bases de données, Réseaux…")}</div>`}`;
  $('#add-sub').onclick = () => subjectForm();
};

function subjectForm(sub) {
  const editing = !!sub;
  const n = S().subjects.length;
  sub = sub || { name: '', icon: '', color: COLORS[n % COLORS.length] };
  modal(`
    <h2>${editing ? 'Modifier la matière' : 'Nouvelle matière'}</h2>
    <form id="f-sub">
      <label>Nom</label><input name="name" value="${esc(sub.name)}" required placeholder="ex. Programmation Python" />
      <label>Icône</label>
      <div class="row" id="icon-pick">${SUBJECT_ICONS.map((i) => `<button type="button" class="btn icon ${i === sub.icon ? 'is-active' : ''}" data-icon="${i}" title="${i}">${ic(i, 22)}</button>`).join('')}</div>
      <input type="hidden" name="icon" value="${sub.icon}" />
      <label>Couleur</label>
      <div class="row" id="color-pick">${COLORS.map((c) => `<button type="button" class="btn icon ${c === sub.color ? 'is-active' : ''}" data-color="${c}" style="width:38px;height:38px;background:${c};border-color:${c === sub.color ? '#16131f' : c}">${c === sub.color ? ic('check', 18) : ''}</button>`).join('')}</div>
      <input type="hidden" name="color" value="${sub.color}" />
      <div class="row" style="margin-top:1.5rem;justify-content:flex-end">
        <button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${ic('check', 18)} Enregistrer</button>
      </div>
    </form>`, (dlg) => {
    const form = $('#f-sub', dlg);
    $$('[data-icon]', dlg).forEach((b) => (b.onclick = () => {
      form.icon.value = b.dataset.icon;
      $$('[data-icon]', dlg).forEach((x) => x.classList.toggle('is-active', x === b));
    }));
    $$('[data-color]', dlg).forEach((b) => (b.onclick = () => {
      form.color.value = b.dataset.color;
      $$('[data-color]', dlg).forEach((x) => {
        x.innerHTML = x === b ? ic('check', 18) : '';
        x.style.borderColor = x === b ? '#16131f' : x.dataset.color;
      });
    }));
    form.name.oninput = () => {
      if (!$('[data-icon].is-active', dlg)) form.dataset.auto = guessIcon(form.name.value);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      f.name = f.name.trim();
      if (!f.icon) f.icon = guessIcon(f.name);
      store.update((s) => {
        if (editing) Object.assign(s.subjects.find((x) => x.id === sub.id), f);
        else s.subjects.push({ id: store.uid(), ...f });
      });
      dlg.close();
      render();
    };
  });
}

views.matiere = (id, tab = 'cours') => {
  const s = S();
  const sub = s.subjects.find((x) => x.id === id);
  if (!sub) return (location.hash = '#/matieres');
  const docs = s.docs.filter((d) => d.subjectId === id && d.kind === (tab === 'series' ? 'serie' : 'cours')).sort((a, b) => b.createdAt - a.createdAt);
  const exs = s.exercises.filter((e) => e.subjectId === id);

  app.innerHTML = `
    <div class="header row spread">
      <div><a href="#/matieres" class="back">${ic('left', 16)} Mes matières</a>
        <div class="row" style="gap:.9rem">${badge(sub, 52)}<h1>${esc(sub.name)}</h1></div></div>
      <div class="row"><button class="btn sm" id="edit-sub">${ic('pencil', 16)} Modifier</button><button class="btn sm danger" id="del-sub">${ic('trash', 16)} Supprimer</button></div>
    </div>
    <div class="tabs">
      <button data-tab="cours" class="${tab === 'cours' ? 'active' : ''}">${ic('file', 18)} Cours</button>
      <button data-tab="series" class="${tab === 'series' ? 'active' : ''}">${ic('pencil', 18)} TP, TD & séries</button>
      <button data-tab="echeances" class="${tab === 'echeances' ? 'active' : ''}">${ic('clock', 18)} Devoirs & examens</button>
    </div>
    <div id="tab-body"></div>`;

  const body = $('#tab-body');
  if (tab === 'echeances') {
    body.innerHTML = `<div class="card"><div class="row spread" style="margin-bottom:1rem"><h2 style="margin:0">${ic('clock')} Échéances de ${esc(sub.name)}</h2><button class="btn primary" id="add-dl">${ic('plus', 18)} Ajouter</button></div>
      ${deadlineCards(sortedDeadlines((d) => d.subjectId === id), { withSubject: false })}</div>`;
    $('#add-dl').onclick = () => deadlineForm(id);
    bindDeadlines(body);
  } else {
    const isSerie = tab === 'series';
    body.innerHTML = `
      <div class="card">
        <div class="dropzone" id="drop">
          ${badge({ icon: 'upload', color: '#6c4cf5' }, 56)}
          <b>${isSerie ? 'Dépose ta série, ton TP ou ton TD' : 'Dépose ton cours'} (PDF ou texte)</b>
          glisse le fichier ici ou clique pour le choisir
          <div class="small" style="margin-top:.5rem">${AI.hasAI() ? `<span class="pill violet">${ic('sparkles', 13)} Analyse par IA activée</span>` : `<span class="pill">Analyse automatique · ${cloudEnabled() ? 'connecte-toi' : 'active l’IA'} pour un résumé détaillé</span>`}</div>
        </div>
        <input type="file" id="file" accept=".pdf,.txt,.md,.py,.sql,.c,.java,.js" hidden />
        <details style="margin-top:.85rem"><summary class="small muted" style="cursor:pointer">…ou colle le texte directement</summary>
          <input id="paste-name" placeholder="Titre (ex. Chapitre 3 — Fonctions)" style="margin-top:.6rem" />
          <textarea id="paste-text" placeholder="Colle ici le contenu" style="margin-top:.5rem"></textarea>
          <button class="btn primary" id="paste-go" style="margin-top:.6rem">${ic('sparkles', 18)} Analyser ce texte</button>
        </details>
        <div id="upload-status" class="small" style="margin-top:.6rem"></div>
      </div>
      ${isSerie ? exerciseList(exs, docs) : docList(docs)}`;
    bindUpload(id, isSerie ? 'serie' : 'cours');
  }

  $$('.tabs button').forEach((b) => (b.onclick = () => (location.hash = `#/matiere/${id}/${b.dataset.tab}`)));
  $('#edit-sub').onclick = () => subjectForm(sub);
  $('#del-sub').onclick = () => {
    if (!confirm(`Supprimer « ${sub.name} » et tous ses documents, exercices, cours et échéances ?`)) return;
    store.update((st) => {
      st.subjects = st.subjects.filter((x) => x.id !== id);
      st.docs = st.docs.filter((x) => x.subjectId !== id);
      st.exercises = st.exercises.filter((x) => x.subjectId !== id);
      st.events = st.events.filter((x) => x.subjectId !== id);
      st.deadlines = st.deadlines.filter((x) => x.subjectId !== id);
    });
    location.hash = '#/matieres';
  };
};

function docList(docs) {
  if (!docs.length) return `<div class="card">${emptyState('file', "Aucun cours pour l'instant. Dépose ton premier PDF ci-dessus : on te prépare un résumé détaillé.")}</div>`;
  return `<div class="card"><h2>${ic('file')} Mes cours</h2><ul class="list">${docs.map((d) => `
    <li>${badge({ icon: 'file', color: '#3aa6e0' }, 40)}<span class="grow"><a href="#/doc/${d.id}"><b>${esc(d.name)}</b></a><div class="muted small">${new Date(d.createdAt).toLocaleDateString('fr-FR')} · ${d.analysisMode === 'ai' ? 'résumé IA détaillé' : 'analyse automatique'}</div></span>
    <a class="btn sm primary" href="#/doc/${d.id}">Ouvrir ${ic('right', 16)}</a></li>`).join('')}</ul></div>`;
}

function exerciseList(exs, series) {
  if (!exs.length) return `<div class="card">${emptyState('pencil', 'Aucun exercice. Dépose une série ci-dessus, ou génère un TP / TD depuis un cours.')}</div>`;
  return series.map((sr) => {
    const list = exs.filter((e) => e.docId === sr.id).sort((a, b) => a.num - b.num);
    if (!list.length) return '';
    const done = list.filter((e) => e.status === 'done').length;
    return `<div class="card"><div class="row spread" style="margin-bottom:.4rem"><h2 style="margin:0">${ic(sr.generated ? 'sparkles' : 'clipboard')} ${esc(sr.name)}</h2>
        <span class="row">${sr.generated ? `<span class="pill violet">${ic('crown', 12)} généré</span>` : ''}<span class="pill ${done === list.length ? 'ok' : ''}">${done}/${list.length} réussis</span><button class="btn sm ghost icon danger" data-del-serie="${sr.id}" title="Supprimer">${ic('trash', 16)}</button></span></div>
      <ul class="list">${list.map((e) => `<li>${e.status === 'done' ? `<span class="pill ok">${ic('check', 13)}</span>` : e.answer ? '<span class="pill warn">en cours</span>' : '<span class="pill">à faire</span>'}<span class="grow">${esc(e.title)}</span><a class="btn sm ${e.status === 'done' ? '' : 'primary'}" href="#/exo/${e.id}">${e.status === 'done' ? 'Revoir' : 'Résoudre'}</a></li>`).join('')}</ul></div>`;
  }).join('');
}

function bindUpload(subjectId, kind) {
  const drop = $('#drop');
  const input = $('#file');
  const status = $('#upload-status');
  drop.onclick = () => input.click();
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]);
  };
  input.onchange = () => input.files[0] && handle(input.files[0]);
  $('#paste-go').onclick = () => {
    const text = $('#paste-text').value.trim();
    if (text.length < 20) return toast('Texte trop court');
    ingest($('#paste-name').value.trim() || (kind === 'serie' ? 'Série' : 'Cours'), text);
  };
  $$('[data-del-serie]').forEach((b) => (b.onclick = () => {
    if (!confirm('Supprimer cette série et ses exercices ?')) return;
    store.update((s) => {
      s.docs = s.docs.filter((d) => d.id !== b.dataset.delSerie);
      s.exercises = s.exercises.filter((e) => e.docId !== b.dataset.delSerie);
    });
    render();
  }));

  async function handle(file) {
    status.innerHTML = `<span class="spinner"></span> Lecture de « ${esc(file.name)} »…`;
    try {
      const text = await extractText(file);
      await ingest(file.name.replace(/\.[^.]+$/, ''), text);
    } catch (e) {
      console.error(e);
      status.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    }
  }

  async function ingest(name, text) {
    const sub = subjectOf(subjectId);
    const lang = S().settings.lang;
    const doc = { id: store.uid(), subjectId, kind, name, text, createdAt: Date.now() };
    drop.style.pointerEvents = 'none';
    try {
      if (kind === 'cours') {
        status.innerHTML = `<span class="spinner"></span> ${AI.hasAI() ? "L'IA prépare ton résumé détaillé (30 à 60 secondes)…" : 'Analyse du cours…'}`;
        doc.analysis = await analyzeDoc(text, sub.name, lang, doc);
      } else {
        status.innerHTML = `<span class="spinner"></span> Détection des exercices…`;
        let list;
        if (AI.hasAI()) {
          try {
            list = (await AI.splitExercises(text, lang)).exercises;
          } catch (e) {
            toast("L'IA n'a pas pu découper la série", e.message + ' · découpage automatique utilisé.');
          }
        }
        if (!list?.length) list = localSplitExercises(text);
        addExercises(doc, list);
        toast(`${list.length} exercice(s) détecté(s)`, name);
      }
      store.update((s) => {
        s.docs.push(doc);
        store.logActivity();
      });
      if (kind === 'cours') location.hash = `#/doc/${doc.id}`;
      else render();
    } catch (e) {
      console.error(e);
      status.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
    } finally {
      drop.style.pointerEvents = '';
    }
  }
}

function addExercises(doc, list) {
  store.update((s) => {
    list.forEach((x, i) =>
      s.exercises.push({
        id: store.uid(), docId: doc.id, subjectId: doc.subjectId, num: i + 1, title: x.title || `Exercice ${i + 1}`,
        statement: x.statement, status: 'todo', answer: '', hints: [], feedback: '', solution: x.solution || '', solutionShown: false,
      }),
    );
  });
}

async function analyzeDoc(text, subjectName, lang, doc) {
  if (AI.hasAI()) {
    try {
      const a = await AI.analyzeCourse(text, subjectName, lang);
      doc.analysisMode = 'ai';
      return a;
    } catch (e) {
      toast("L'analyse IA a échoué", `${e.message}\nAnalyse automatique utilisée à la place.`, 10000);
    }
  }
  doc.analysisMode = 'local';
  return localAnalysis(text);
}

const LANGS = [['fr', 'Français'], ['ar', 'العربية'], ['en', 'English']];

views.doc = (id, tab = 'resume') => {
  const s = S();
  const doc = s.docs.find((d) => d.id === id);
  if (!doc) return (location.hash = '#/matieres');
  const sub = subjectOf(doc.subjectId);
  const a = doc.analysis || {};
  const premium = Plan.isPremium();
  app.innerHTML = `
    <div class="header row spread">
      <div><a href="#/matiere/${doc.subjectId}" class="back">${ic('left', 16)} ${esc(sub.name)}</a><h1>${esc(doc.name)}</h1>
      <div class="muted small">${doc.analysisMode === 'ai' ? `<span class="pill violet">${ic('sparkles', 12)} Résumé IA détaillé</span>` : '<span class="pill">Analyse automatique</span>'}</div></div>
      <div class="row"><button class="btn sm ${AI.hasAI() && doc.analysisMode !== 'ai' ? 'ai' : ''}" id="reanalyze">${ic(AI.hasAI() ? 'sparkles' : 'refresh', 16)} ${AI.hasAI() ? (doc.analysisMode === 'ai' ? 'Refaire le résumé' : 'Résumé détaillé par IA') : 'Ré-analyser'}</button>
        <button class="btn sm danger" id="del-doc">${ic('trash', 16)}</button></div>
    </div>
    <div class="tabs">
      <button data-tab="resume" class="${tab === 'resume' ? 'active' : ''}">${ic('book', 18)} Résumé</button>
      <button data-tab="fiches" class="${tab === 'fiches' ? 'active' : ''}">${ic('layers', 18)} Fiches mémo</button>
      <button data-tab="explique" class="${tab === 'explique' ? 'active' : ''}">${ic('chat', 18)} Explique-moi</button>
      <button data-tab="generer" class="${tab === 'generer' ? 'active' : ''}">${ic('crown', 18)} TP / TD corrigés</button>
      <button data-tab="texte" class="${tab === 'texte' ? 'active' : ''}">${ic('file', 18)} Texte</button>
    </div>
    <div id="tab-body"></div>`;
  const body = $('#tab-body');

  if (tab === 'resume') {
    body.innerHTML = `
      ${doc.analysisMode !== 'ai' ? `<div class="banner violet">${ic('sparkles', 22)}<span class="grow">Ceci est une analyse automatique. Pour un <b>résumé détaillé et expliqué</b> de tout le cours, ${AI.hasAI() ? 'clique sur « Résumé détaillé par IA »' : aiWhere()}.</span>${AI.hasAI() ? '' : `<a class="btn sm ai" href="${aiHref()}">${aiCta()}</a>`}</div>` : ''}
      <div class="card"><h2>${ic('book')} Résumé du cours</h2>${md(a.summary)}</div>
      ${a.keyPoints?.length ? `<div class="card sky"><h2>${ic('target')} À retenir absolument</h2><div class="row">${a.keyPoints.map((k) => `<span class="pill" style="font-size:.85rem;padding:.3rem .8rem">${esc(k)}</span>`).join('')}</div></div>` : ''}
      <div class="grid grid-2">
        ${a.definitions?.length ? `<div class="card"><h2>${ic('bulb')} Définitions</h2>${a.definitions.map((d) => `<div class="def"><b>${esc(d.term)}</b> : ${esc(d.definition)}</div>`).join('')}</div>` : ''}
        ${a.formulas?.length ? `<div class="card"><h2>${ic('sigma')} Formules</h2>${a.formulas.map((f) => `<div class="formula">${esc(f.formula)}</div>${f.meaning ? `<div class="small muted" style="margin:-.1rem 0 .7rem .9rem">${esc(f.meaning)}</div>` : ''}`).join('')}</div>` : ''}
      </div>
      ${a.codes?.length ? `<div class="card"><h2>${ic('code')} Codes à connaître</h2>${a.codes.map((c) => `<pre><code>${esc(c.code)}</code></pre>${c.explanation ? md(c.explanation) : ''}`).join('')}</div>` : ''}
      ${a.questions?.length ? `<div class="card"><h2>${ic('alert')} Questions possibles à l'examen</h2><ol>${a.questions.map((q) => `<li style="margin:.3rem 0">${esc(q)}</li>`).join('')}</ol></div>` : ''}
      ${a.sheet ? `<div class="card violet"><h2>${ic('clipboard')} Fiche de révision express</h2>${md(a.sheet)}</div>` : ''}`;
  } else if (tab === 'fiches') {
    const cards = [
      ...(a.definitions || []).map((d) => ({ q: d.term, r: d.definition })),
      ...(a.formulas || []).filter((f) => f.meaning).map((f) => ({ q: f.meaning, r: f.formula })),
    ];
    if (!cards.length) {
      body.innerHTML = `<div class="card">${emptyState('layers', 'Pas assez de définitions dans ce cours pour créer des fiches. Le résumé IA en trouve généralement plus.')}</div>`;
    } else {
      let i = 0, flipped = false;
      const draw = () => {
        const c = cards[i];
        body.innerHTML = `<div class="card" style="max-width:640px;margin:0 auto">
          <div class="row spread"><h2 style="margin:0">${ic('layers')} Fiches mémo</h2><span class="pill">${i + 1} / ${cards.length}</span></div>
          <div class="card flash ${flipped ? 'back' : ''}" id="flash" style="margin:1rem 0">${flipped ? `<div>${esc(c.r)}</div>` : `<div><div class="small muted">Que signifie…</div><b style="font-size:1.4rem">${esc(c.q)}</b><div class="small muted" style="margin-top:.8rem">Clique pour voir la réponse</div></div>`}</div>
          <div class="row spread"><button class="btn" id="fprev" ${i === 0 ? 'disabled' : ''}>${ic('left', 18)} Précédente</button><button class="btn primary" id="fnext">${i === cards.length - 1 ? 'Recommencer' : 'Suivante'} ${ic('right', 18)}</button></div></div>`;
        $('#flash').onclick = () => {
          flipped = !flipped;
          draw();
        };
        $('#fprev').onclick = () => {
          i--;
          flipped = false;
          draw();
        };
        $('#fnext').onclick = () => {
          i = (i + 1) % cards.length;
          flipped = false;
          draw();
        };
      };
      draw();
    }
  } else if (tab === 'explique') {
    body.innerHTML = `
      <div class="card">
        <h2>${ic('chat')} Je ne comprends pas cette partie…</h2>
        <p class="muted small">Colle un passage (ou sélectionne-le dans l'onglet « Texte »), puis choisis comment tu veux qu'on te l'explique.</p>
        <textarea id="passage" placeholder="Colle ici le passage difficile">${esc(sessionStorage.getItem('sf:passage') || '')}</textarea>
        <div class="row" style="margin:.85rem 0"><span class="small muted">Langue :</span>
          <div class="row" id="lang-pick">${LANGS.map(([v, l]) => `<button class="btn sm ${S().settings.lang === v ? 'is-active' : ''}" data-lang="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="row">${Object.entries(AI.EXPLAIN_MODES).map(([k, m]) => `<button class="btn ai" data-mode="${k}">${m.label}</button>`).join('')}</div>
        <div id="explain-out"></div>
      </div>`;
    sessionStorage.removeItem('sf:passage');
    let lang = S().settings.lang;
    $$('[data-lang]').forEach((b) => (b.onclick = () => {
      lang = b.dataset.lang;
      $$('[data-lang]').forEach((x) => x.classList.toggle('is-active', x === b));
    }));
    $$('[data-mode]').forEach((b) => (b.onclick = () => busy(b, async () => {
      if (!AI.hasAI()) throw new Error(AI.missingMessage());
      const passage = $('#passage').value.trim();
      if (!passage) throw new Error("Colle d'abord un passage du cours.");
      const out = await AI.explain(passage, b.dataset.mode, sub.name, lang);
      $('#explain-out').innerHTML = `<div class="feedback ai" ${lang === 'ar' ? 'dir="rtl"' : ''}><b>${ic('sparkles', 18)} Explication</b>${md(out)}</div>`;
      store.update(store.logActivity);
    }, "L'IA réfléchit…")));
  } else if (tab === 'generer') {
    const st = Plan.status();
    if (!premium) {
      body.innerHTML = `<div class="card violet lock-overlay">
        ${badge({ icon: 'crown', color: '#6c4cf5' }, 64)}
        <h2 style="justify-content:center;margin-top:1rem">TP et TD corrigés à partir de ton cours</h2>
        <p class="muted" style="max-width:520px;margin:0 auto 1.2rem">StudyFlow crée des TD d'exercices, des TP pratiques et des examens blancs fidèles à ce cours, avec une correction détaillée étape par étape.</p>
        ${trialCta(st)}
        <p class="small muted" style="margin-top:1rem">Ensuite à partir de ${minPrice()}. Le résumé de cours, les fiches et les rappels restent gratuits.</p></div>`;
      bindTrial();
    } else {
      const gens = S().docs.filter((d) => d.sourceDocId === id);
      body.innerHTML = `
        <div class="card">
          <div class="row spread"><h2 style="margin:0">${ic('crown')} Générer un TP / TD corrigé</h2>${st.kind === 'trial' ? `<span class="pill violet">Essai : ${st.daysLeft} j restants</span>` : '<span class="pill dark">Premium</span>'}</div>
          <p class="muted small">Basé uniquement sur ce cours. Les corrections sont cachées : essaie d'abord, puis demande un indice ou la solution.</p>
          <label>Type</label>
          <div class="row" id="gen-type">${Object.entries(AI.GEN_TYPES).map(([k, t], i) => `<button class="btn ${i === 0 ? 'is-active' : ''}" data-type="${k}">${ic(k === 'tp' ? 'flask' : k === 'td' ? 'clipboard' : 'alert', 18)} ${t.label}</button>`).join('')}</div>
          <div class="form-row">
            <div><label>Nombre d'exercices</label><select id="gen-count">${[3, 4, 5, 6, 8].map((n) => `<option ${n === 4 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
            <div><label>Niveau</label><select id="gen-level"><option value="facile">Facile</option><option value="moyen" selected>Moyen</option><option value="difficile">Difficile (niveau examen)</option></select></div>
          </div>
          <button class="btn ai lg" id="gen-go" style="margin-top:1.2rem">${ic('sparkles', 18)} Générer avec corrections</button>
          ${!AI.hasAI() ? `<div class="banner warn small" style="margin-top:1rem">${ic('alert', 18)} La génération utilise l'IA : ${aiWhere()}.</div>` : ''}
        </div>
        ${gens.length ? `<div class="card"><h2>${ic('list')} Déjà générés pour ce cours</h2><ul class="list">${gens.map((g) => `<li>${ic('sparkles', 18)}<span class="grow">${esc(g.name)}</span><a class="btn sm" href="#/matiere/${g.subjectId}/series">Ouvrir</a></li>`).join('')}</ul></div>` : ''}`;
      let type = 'td';
      $$('[data-type]').forEach((b) => (b.onclick = () => {
        type = b.dataset.type;
        $$('[data-type]').forEach((x) => x.classList.toggle('is-active', x === b));
      }));
      $('#gen-go').onclick = (e) => busy(e.currentTarget, async () => {
        if (!AI.hasAI()) throw new Error(AI.missingMessage());
        if (!Plan.isPremium()) throw new Error('Ton accès Premium a expiré.');
        const res = await AI.generateSet(doc.text, sub.name, { type, count: Number($('#gen-count').value), level: $('#gen-level').value }, S().settings.lang);
        if (!res.exercises?.length) throw new Error("L'IA n'a pas produit d'exercices, réessaie.");
        const label = { td: 'TD', tp: 'TP', exam: 'Examen blanc' }[type];
        const gdoc = { id: store.uid(), subjectId: doc.subjectId, kind: 'serie', name: res.title || `${label} — ${doc.name}`, text: res.exercises.map((x) => `${x.title}\n${x.statement}`).join('\n\n'), createdAt: Date.now(), generated: true, sourceDocId: id };
        addExercises(gdoc, res.exercises);
        store.update((st2) => {
          st2.docs.push(gdoc);
          store.logActivity();
        });
        toast(`${label} prêt !`, `${res.exercises.length} exercices avec corrections.`);
        location.hash = `#/exo/${S().exercises.find((x) => x.docId === gdoc.id).id}`;
      }, 'Création du sujet (environ 1 minute)…');
    }
  } else {
    body.innerHTML = `<div class="card"><div class="row spread"><p class="muted small" style="margin:0">Sélectionne un passage puis clique sur « Explique-moi ce passage ».</p><button class="btn sm ai" id="explain-sel">${ic('chat', 16)} Explique-moi ce passage</button></div>
      <div id="doc-text" style="white-space:pre-wrap;margin-top:1rem;font-size:.93rem">${esc(doc.text)}</div></div>`;
    $('#explain-sel').onclick = () => {
      const sel = String(window.getSelection() || '').trim();
      if (!sel) return toast('Sélectionne d’abord un passage du texte');
      sessionStorage.setItem('sf:passage', sel);
      location.hash = `#/doc/${id}/explique`;
    };
  }

  $$('.tabs button').forEach((b) => (b.onclick = () => (location.hash = `#/doc/${id}/${b.dataset.tab}`)));
  $('#reanalyze').onclick = (e) => busy(e.currentTarget, async () => {
    const tmp = {};
    const analysis = await analyzeDoc(doc.text, sub.name, S().settings.lang, tmp);
    store.update((st) => Object.assign(st.docs.find((d) => d.id === id), { analysis, analysisMode: tmp.analysisMode }));
    toast(tmp.analysisMode === 'ai' ? 'Résumé détaillé prêt' : 'Analyse mise à jour');
    render();
  }, AI.hasAI() ? 'Rédaction du résumé…' : 'Analyse…');
  $('#del-doc').onclick = () => {
    if (!confirm('Supprimer ce cours ?')) return;
    store.update((st) => (st.docs = st.docs.filter((d) => d.id !== id)));
    location.hash = `#/matiere/${doc.subjectId}`;
  };
};

views.exo = (id) => {
  const s = S();
  const ex = s.exercises.find((e) => e.id === id);
  if (!ex) return (location.hash = '#/matieres');
  const sub = subjectOf(ex.subjectId);
  const serie = s.docs.find((d) => d.id === ex.docId);
  const siblings = s.exercises.filter((e) => e.docId === ex.docId).sort((a, b) => a.num - b.num);
  const idx = siblings.findIndex((e) => e.id === id);
  const prev = siblings[idx - 1], next = siblings[idx + 1];
  const lang = s.settings.lang;
  const looksCode = /python|code|fonction|programme|algorithme|sql|requête|script|java|c\+\+/i.test(sub.name + ' ' + ex.statement);
  const hasSol = !!ex.solution;
  const answered = !!ex.answer?.trim();

  app.innerHTML = `
    <div class="header">
      <a href="#/matiere/${ex.subjectId}/series" class="back">${ic('left', 16)} ${esc(sub.name)} · ${esc(serie?.name || 'séries')}</a>
      <div class="row spread"><h1>${esc(ex.title)}</h1><div class="row"><span class="pill">${idx + 1} / ${siblings.length}</span>${ex.status === 'done' ? `<span class="pill ok">${ic('check', 13)} Réussi</span>` : ''}</div></div>
    </div>
    <div class="card sky"><h2>${ic('clipboard')} Énoncé</h2>${md(ex.statement)}</div>
    <div class="card">
      <h2>${ic('pencil')} Ma réponse</h2>
      <textarea id="answer" class="${looksCode ? 'code' : ''}" placeholder="Essaie seul d'abord : écris ta réponse ici (code, calcul, rédaction…)" style="min-height:200px">${esc(ex.answer)}</textarea>
      <div class="row" style="margin-top:.9rem">
        <button class="btn primary" id="check" ${answered ? '' : 'disabled'}>${ic('search', 18)} Corriger ma réponse</button>
        <button class="btn" id="hint" ${ex.hints.length >= 3 ? 'disabled' : ''}>${ic('bulb', 18)} Indice ${ex.hints.length ? `(${ex.hints.length}/3)` : ''}</button>
        <button class="btn ${ex.solutionShown ? 'is-active' : ''}" id="sol">${ic('eye', 18)} ${ex.solutionShown ? 'Masquer la solution' : 'Voir la solution'}</button>
        <span class="grow"></span>
        <button class="btn ${ex.status === 'done' ? 'done' : ''}" id="done">${ic('checkCircle', 18)} ${ex.status === 'done' ? 'Réussi' : 'Je l’ai réussi'}</button>
      </div>
      ${!AI.hasAI() ? `<div class="banner warn small" style="margin-top:1rem">${ic('alert', 18)}<span>La correction et les indices utilisent l'IA : ${aiWhere()}.${hasSol ? ' La solution de ce sujet est déjà disponible.' : ''} Ta réponse est sauvegardée automatiquement.</span></div>` : ''}
      ${ex.hints.map((h, i) => `<div class="feedback hint"><b>${ic('bulb', 18)} Indice ${i + 1}</b>${md(h)}</div>`).join('')}
      ${ex.feedback ? `<div class="feedback ai"><b>${ic('sparkles', 18)} Correction de ta réponse</b>${md(ex.feedback)}</div>` : ''}
      ${ex.solutionShown && hasSol ? `<div class="feedback solution"><b>${ic('checkCircle', 18)} Solution détaillée</b>${md(ex.solution)}</div>` : ''}
    </div>
    <div class="row spread">
      ${prev ? `<a class="btn" href="#/exo/${prev.id}">${ic('left', 18)} ${esc(prev.title.slice(0, 32))}</a>` : '<span></span>'}
      ${next ? `<a class="btn primary" href="#/exo/${next.id}">${esc(next.title.slice(0, 32))} ${ic('right', 18)}</a>` : ''}
    </div>`;

  const ans = $('#answer');
  let t;
  ans.oninput = () => {
    $('#check').disabled = !ans.value.trim();
    clearTimeout(t);
    t = setTimeout(() => store.update((st) => (st.exercises.find((e) => e.id === id).answer = ans.value)), 400);
  };
  const saveAnswer = () => store.update((st) => (st.exercises.find((e) => e.id === id).answer = ans.value));
  const cur = () => S().exercises.find((e) => e.id === id);
  const requireAI = () => {
    if (!AI.hasAI()) throw new Error(AI.missingMessage());
  };

  $('#check').onclick = (e) => busy(e.currentTarget, async () => {
    requireAI();
    saveAnswer();
    const fb = await AI.correct(cur(), sub.name, lang);
    store.update((st) => {
      const x = st.exercises.find((e) => e.id === id);
      x.feedback = fb;
      x.attempts = (x.attempts || 0) + 1;
      if (/^\W*Correct/i.test(fb.trim().replace(/^✅\s*/, ''))) x.status = 'done';
      store.logActivity();
    });
    render();
  }, 'Correction…');
  $('#hint').onclick = (e) => busy(e.currentTarget, async () => {
    requireAI();
    saveAnswer();
    const h = await AI.hint(cur(), sub.name, lang);
    store.update((st) => st.exercises.find((e) => e.id === id).hints.push(h));
    render();
  }, 'Indice…');
  $('#sol').onclick = (e) => {
    const x = cur();
    if (x.solutionShown) {
      store.update((st) => (st.exercises.find((e) => e.id === id).solutionShown = false));
      return render();
    }
    if (!x.answer?.trim() && !confirm("Tu n'as encore rien essayé. Chercher un peu (ou demander un indice) t'aide beaucoup plus à retenir. Voir quand même la solution ?")) return;
    busy(e.currentTarget, async () => {
      saveAnswer();
      if (!cur().solution) {
        requireAI();
        const sol = await AI.solution(cur(), sub.name, lang);
        store.update((st) => (st.exercises.find((e) => e.id === id).solution = sol));
      }
      store.update((st) => (st.exercises.find((e) => e.id === id).solutionShown = true));
      render();
    }, 'Solution…');
  };
  $('#done').onclick = () => {
    saveAnswer();
    store.update((st) => {
      const x = st.exercises.find((e) => e.id === id);
      x.status = x.status === 'done' ? 'todo' : 'done';
      store.logActivity();
    });
    if (cur().status === 'done') toast('Bravo !', next ? 'On passe au suivant ?' : 'Série terminée !');
    render();
  };
};

// ---------- Échéances ----------
function deadlineForm(subjectId, presetType = 'devoir') {
  if (!S().subjects.length) return toast('Ajoute d’abord une matière');
  const d = new Date(Date.now() + 7 * 86400000);
  d.setHours(9, 0, 0, 0);
  const local = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal(`
    <h2>${ic('clock')} Nouvelle échéance</h2>
    <form id="f-dl">
      <label>Type</label>
      <div class="row">${Object.entries(DEADLINE_TYPES).map(([k, t]) => `<button type="button" class="btn sm ${k === presetType ? 'is-active' : ''}" data-dtype="${k}">${ic(t.icon, 16)} ${t.label}</button>`).join('')}</div>
      <input type="hidden" name="type" value="${presetType}" />
      <label>Titre</label><input name="title" required placeholder="ex. Rendre le TP 2 sur les jointures SQL" />
      <div class="form-row">
        <div><label>Matière</label><select name="subjectId">${subjectOptions(subjectId)}</select></div>
        <div><label>Date limite</label><input type="datetime-local" name="due" value="${local}" required /></div>
      </div>
      <p class="small muted">Rappels automatiques 3 jours, 1 jour et 3 heures avant.</p>
      <div class="row" style="margin-top:1rem;justify-content:flex-end"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${ic('plus', 18)} Ajouter</button></div>
    </form>`, (dlg) => {
    const form = $('#f-dl', dlg);
    $$('[data-dtype]', dlg).forEach((b) => (b.onclick = () => {
      form.type.value = b.dataset.dtype;
      $$('[data-dtype]', dlg).forEach((x) => x.classList.toggle('is-active', x === b));
    }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      store.update((s) => s.deadlines.push({ id: store.uid(), ...f, title: f.title.trim(), done: false }));
      dlg.close();
      toast('Échéance ajoutée', 'Tu seras prévenu avant la date limite.');
      render();
    };
  });
}

views.echeances = (filter = 'avenir') => {
  const now = new Date();
  const all = sortedDeadlines();
  const lists = {
    avenir: all.filter((d) => !d.done && new Date(d.due) >= now),
    retard: all.filter((d) => !d.done && new Date(d.due) < now),
    faits: all.filter((d) => d.done),
  };
  app.innerHTML = `
    <div class="header row spread"><div><h1>Échéances</h1><div class="muted">Devoirs, TP, TD, projets et examens : tout ce qui a une date limite.</div></div>
      <button class="btn primary" id="add-dl">${ic('plus', 18)} Nouvelle échéance</button></div>
    <div class="tabs">
      <button data-f="avenir" class="${filter === 'avenir' ? 'active' : ''}">${ic('clock', 18)} À venir (${lists.avenir.length})</button>
      <button data-f="retard" class="${filter === 'retard' ? 'active' : ''}">${ic('alert', 18)} En retard (${lists.retard.length})</button>
      <button data-f="faits" class="${filter === 'faits' ? 'active' : ''}">${ic('check', 18)} Terminés (${lists.faits.length})</button>
    </div>
    <div class="card">${deadlineCards(lists[filter] || lists.avenir)}</div>`;
  $('#add-dl').onclick = () => deadlineForm();
  $$('[data-f]').forEach((b) => (b.onclick = () => (location.hash = `#/echeances/${b.dataset.f}`)));
  bindDeadlines();
};

// ---------- Emploi du temps ----------
function eventForm(day = 1) {
  if (!S().subjects.length) return toast('Ajoute d’abord une matière');
  modal(`
    <h2>${ic('calendar')} Ajouter un cours</h2>
    <form id="f-ev">
      <label>Matière</label><select name="subjectId">${subjectOptions()}</select>
      <div class="form-row">
        <div><label>Jour</label><select name="day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></div>
        <div><label>Début</label><input type="time" name="start" value="08:00" required /></div>
        <div><label>Fin</label><input type="time" name="end" value="10:00" required /></div>
      </div>
      <label>Salle / lieu (optionnel)</label><input name="room" placeholder="ex. Amphi B" />
      <div class="row" style="margin-top:1.25rem;justify-content:flex-end"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${ic('plus', 18)} Ajouter</button></div>
    </form>`, (dlg) => {
    $('#f-ev', dlg).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.end <= f.start) return toast("L'heure de fin doit être après le début");
      store.update((s) => s.events.push({ id: store.uid(), ...f, day: Number(f.day) }));
      dlg.close();
      render();
    };
  });
}

const DAY_ALIASES = { dim: 0, dimanche: 0, sun: 0, lun: 1, lundi: 1, mon: 1, mar: 2, mardi: 2, tue: 2, mer: 3, mercredi: 3, wed: 3, jeu: 4, jeudi: 4, thu: 4, ven: 5, vendredi: 5, fri: 5, sam: 6, samedi: 6, sat: 6 };

/** Importe des lignes du type « Lundi 08:00-10:00 Python, Amphi B ». Crée les matières manquantes. */
function importSchedule(text) {
  let n = 0;
  const errors = [];
  store.update((s) => {
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(\p{L}+)\.?[\s,;:|-]+(\d{1,2})[h:.]?(\d{2})?\s*(?:-|–|à|a|to)\s*(\d{1,2})[h:.]?(\d{2})?[\s,;:|-]+(.+)$/iu);
      const day = m && DAY_ALIASES[m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
      if (!m || day === undefined) {
        errors.push(line);
        continue;
      }
      const hm = (h, mm) => `${String(h).padStart(2, '0')}:${mm || '00'}`;
      const [name, ...roomParts] = m[6].split(/\s*[,;|(]\s*|\s+-\s+|\s+salle\s+/i);
      const room = m[6].match(/(salle|amphi|room|labo)\s*[^\s)]+/i)?.[0] || roomParts.join(' ').replace(/\)$/, '');
      let sub = s.subjects.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
      if (!sub) {
        sub = { id: store.uid(), name: name.trim(), icon: guessIcon(name), color: COLORS[s.subjects.length % COLORS.length] };
        s.subjects.push(sub);
      }
      s.events.push({ id: store.uid(), subjectId: sub.id, day, start: hm(m[2], m[3]), end: hm(m[4], m[5]), room: room?.trim() || '' });
      n++;
    }
  });
  return { n, errors };
}

views.planning = () => {
  const s = S();
  const now = new Date();
  const order = [1, 2, 3, 4, 5, 6, 0];
  app.innerHTML = `
    <div class="header row spread"><div><h1>Emploi du temps</h1><div class="muted">Rappel ${(s.settings.leads || []).join(' et ')} minutes avant chaque cours.</div></div>
      <div class="row"><button class="btn" id="import">${ic('upload', 18)} Importer</button><button class="btn primary" id="add-ev">${ic('plus', 18)} Ajouter un cours</button></div></div>
    <div class="week">${order.map((d) => {
      const evs = s.events.filter((e) => Number(e.day) === d).sort((a, b) => a.start.localeCompare(b.start));
      return `<div class="day-col ${d === now.getDay() ? 'today' : ''}"><h4>${DAYS[d]}</h4>
        ${evs.map((e) => {
          const sub = subjectOf(e.subjectId);
          return `<div class="slot" style="--c:${sub.color}"><button class="x" data-ev-del="${e.id}" title="Retirer">${ic('x', 14)}</button><b>${e.start}–${e.end}</b><br>${esc(sub.name)}${e.room ? `<br><span class="muted">${esc(e.room)}</span>` : ''}</div>`;
        }).join('')}
        <button class="btn sm ghost" data-add-day="${d}" style="width:100%">${ic('plus', 16)}</button></div>`;
    }).join('')}</div>
    <div class="grid grid-2" style="margin-top:1.1rem">
      <div class="card"><div class="row spread"><h2 style="margin:0">${ic('clock')} Prochaines échéances</h2><a class="btn sm" href="#/echeances">Tout voir</a></div><div style="margin-top:1rem">${deadlineCards(sortedDeadlines((d) => !d.done), { limit: 4 })}</div></div>
      <div class="card sky"><h2>${ic('bell')} Tester un rappel</h2><p class="small muted">Vois à quoi ressemble la notification de ton prochain cours.</p><button class="btn primary" id="test-notif">${ic('bell', 18)} Envoyer un rappel de test</button></div>
    </div>`;

  $('#add-ev').onclick = () => eventForm();
  $$('[data-add-day]').forEach((b) => (b.onclick = () => eventForm(Number(b.dataset.addDay))));
  $$('[data-ev-del]').forEach((b) => (b.onclick = () => {
    store.update((st) => (st.events = st.events.filter((e) => e.id !== b.dataset.evDel)));
    render();
  }));
  bindDeadlines();
  $('#test-notif').onclick = async () => {
    if (!s.settings.notifications && 'Notification' in window && Notification.permission === 'default') await enableNotifications();
    const nxt = upcoming(20).find((i) => i.kind === 'cours');
    if (!nxt) return notify('StudyFlow', 'Ajoute un cours à ton emploi du temps pour recevoir des rappels.');
    notify(`${nxt.subject.name} · ${nxt.ev.start}`, classMessage(nxt.ev, nxt.date).join('\n'));
  };
  $('#import').onclick = () => modal(`
    <h2>${ic('upload')} Importer l'emploi du temps</h2>
    <p class="small muted">Une ligne par cours : <code>Jour Début-Fin Matière, Salle</code>. Les matières manquantes sont créées automatiquement.</p>
    <textarea id="imp" class="code" style="min-height:170px" placeholder="Lundi 08:00-10:00 Python, Amphi A
Mardi 10h-12h Bases de données
Lundi 14:00-16:00 Mathématiques, Salle 12"></textarea>
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="imp-go">${ic('check', 18)} Importer</button></div>`, (dlg) => {
    $('#imp-go', dlg).onclick = () => {
      const { n, errors } = importSchedule($('#imp', dlg).value);
      dlg.close();
      toast(`${n} cours importé(s)`, errors.length ? `Lignes non comprises :\n${errors.slice(0, 5).join('\n')}` : '');
      render();
    };
  });
};

// ---------- Premium ----------
const fmtDay = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const PAY_STATUS = { pending: ['warn', 'en attente de validation'], approved: ['ok', 'validé'], rejected: ['danger', 'refusé'] };

views.premium = async () => {
  const st = Plan.status();
  const link = Plan.contactLink();
  const cloud = cloudEnabled();
  const free = ['Résumé de cours', 'Fiches mémo et « Explique-moi »', 'Séries d’exercices avec correction et indices', 'Emploi du temps, échéances et rappels', 'Minuteur de concentration'];
  const prem = ['Tout le gratuit', 'TD d’exercices générés à partir de tes cours', 'TP pratiques guidés, étape par étape', 'Examens blancs avec barème', 'Corrections détaillées de chaque exercice', `Jusqu'à ${CONFIG.quotaPremium} demandes IA par jour`];
  const methods = CONFIG.paymentMethods.filter((m) => m.account);
  const canPay = cloud && Cloud.user();

  app.innerHTML = `
    <div class="header"><h1>StudyFlow Premium</h1><div class="muted">Entraîne-toi avec des TP et TD corrigés, créés à partir de tes propres cours.</div></div>
    ${st.kind === 'trial' ? `<div class="banner violet">${ic('crown', 22)}<span>Ton essai gratuit est actif : encore <b>${st.daysLeft} jour${st.daysLeft > 1 ? 's' : ''}</b> (jusqu'au ${fmtDay(st.until)}).</span></div>` : ''}
    ${st.kind === 'expired' ? `<div class="banner warn">${ic('alert', 22)}<span>Ton essai gratuit est terminé. Abonne-toi pour continuer à générer des TP et TD.</span></div>` : ''}
    ${st.kind === 'premium' ? `<div class="banner">${ic('checkCircle', 22)}<span>Tu es Premium jusqu'au <b>${fmtDay(st.until)}</b>. Merci !</span></div>` : ''}
    <div class="grid grid-2">
      <div class="card"><span class="pill">Gratuit</span><div class="price" style="margin-top:.6rem">0 ${CONFIG.currency}</div><div class="muted small">pour toujours${cloud ? ` · ${CONFIG.quotaFree} demandes IA par jour` : ''}</div>
        <ul class="features">${free.map((f) => `<li>${ic('check', 18)} ${f}</li>`).join('')}</ul></div>
      <div class="card dark"><span class="pill violet">${ic('crown', 12)} Premium</span>
        <div class="row" style="margin-top:.6rem;gap:1.4rem">${CONFIG.plans.map((p) => `<div><div class="price" style="font-size:1.5rem">${p.price} ${CONFIG.currency}</div><div class="muted small">${p.label}</div></div>`).join('')}</div>
        <ul class="features">${prem.map((f) => `<li>${ic('check', 18)} ${f}</li>`).join('')}</ul>
        <div style="text-align:center">${['guest', 'free'].includes(st.kind) ? trialCta(st) : ''}</div>
        ${!cloud ? (link ? `<a class="btn lg" href="${esc(link)}" target="_blank" rel="noopener" style="width:100%;margin-top:.6rem">${ic('phone', 18)} S'abonner</a>` : `<button class="btn lg" disabled style="width:100%;margin-top:.6rem">${ic('lock', 18)} Abonnement bientôt disponible</button>`) : ''}
      </div>
    </div>
    ${canPay ? `
    <div class="card" id="pay-card">
      <h2>${ic('phone')} M'abonner</h2>
      ${methods.length ? `
      <ol class="small" style="padding-left:1.2rem">
        <li>Envoie le montant de la formule choisie avec ${methods.map((m) => `<b>${esc(m.label)}</b> au <b>${esc(m.account)}</b>`).join(', ou ')}.</li>
        <li>Remplis le formulaire avec le <b>numéro de transaction</b> reçu par SMS.</li>
        <li>Ton abonnement est activé dès que le paiement est vérifié (en général dans la journée).</li>
      </ol>
      <form id="f-pay">
        <label>Formule</label>
        <div class="row">${CONFIG.plans.map((p, i) => `<button type="button" class="btn ${i === 0 ? 'is-active' : ''}" data-plan="${p.id}">${p.label} · ${p.price} ${CONFIG.currency}</button>`).join('')}</div>
        <input type="hidden" name="plan" value="${CONFIG.plans[0].id}" />
        <div class="form-row">
          <div><label>Moyen de paiement</label><select name="method">${methods.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select></div>
          <div><label>Numéro de transaction</label><input name="reference" required minlength="3" maxlength="80" placeholder="ex. 123456789" /></div>
          <div><label>Ton numéro de téléphone</label><input name="phone" maxlength="30" placeholder="ex. 22 00 00 00" /></div>
        </div>
        <button class="btn primary lg" style="margin-top:1.1rem">${ic('check', 18)} J'ai payé, envoyer</button>
      </form>` : `<p class="muted">Le paiement en ligne n'est pas encore ouvert.${link ? ` <a href="${esc(link)}" target="_blank" rel="noopener">Contacte-nous sur WhatsApp</a>.` : ''}</p>`}
      <div id="my-payments"></div>
    </div>` : ''}
    ${cloud && !Cloud.user() ? `<div class="banner violet">${ic('user', 22)}<span class="grow">Crée ton compte gratuit pour démarrer l'essai et t'abonner.</span><a class="btn sm ai" href="#/compte">Se connecter</a></div>` : ''}`;

  bindTrial();
  const form = $('#f-pay');
  if (form) {
    $$('[data-plan]').forEach((b) => (b.onclick = () => {
      form.plan.value = b.dataset.plan;
      $$('[data-plan]').forEach((x) => x.classList.toggle('is-active', x === b));
    }));
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const plan = CONFIG.plans.find((p) => p.id === f.plan);
      busy(form.querySelector('button.primary'), async () => {
        await Cloud.submitPayment({ plan: plan.id, days: plan.days, amount: plan.price, method: f.method, reference: f.reference.trim(), phone: f.phone.trim() || null });
        toast('Paiement envoyé', 'Ton abonnement sera activé dès la vérification.');
        render();
      }, 'Envoi…');
    };
  }
  if (canPay) {
    try {
      const pays = await Cloud.myPayments();
      const el = $('#my-payments');
      if (el && pays?.length) {
        el.innerHTML = `<h3>Mes paiements</h3><ul class="list">${pays.map((p) => {
          const [cls, label] = PAY_STATUS[p.status] || ['', p.status];
          return `<li><span class="grow"><b>${p.amount} ${CONFIG.currency}</b> · ${esc(p.method)} · n° ${esc(p.reference)}<div class="small muted">${new Date(p.created_at).toLocaleString('fr-FR')}</div></span><span class="pill ${cls}">${label}</span></li>`;
        }).join('')}</ul>`;
      }
      // Rafraîchit le statut au cas où un paiement vient d'être validé
      const before = Cloud.getProfile()?.premium_until;
      await Cloud.refreshProfile();
      if (Cloud.getProfile()?.premium_until !== before && location.hash.startsWith('#/premium')) render();
    } catch (e) {
      console.error(e);
    }
  }
};

// ---------- Compte (connexion / inscription) ----------
views.compte = (mode = 'connexion') => {
  if (!cloudEnabled()) {
    app.innerHTML = `<div class="header"><h1>Mon compte</h1></div><div class="card">${emptyState('user', "Les comptes ne sont pas encore activés sur ce site. Tout fonctionne sans compte : tes données restent dans ton navigateur.")}</div>`;
    return;
  }
  const u = Cloud.user();
  if (u) {
    const p = Cloud.getProfile() || {};
    const st = Plan.status();
    const usage = Cloud.getUsage();
    const label = { premium: ['dark', 'Premium'], trial: ['violet', `Essai · ${st.daysLeft} j`], expired: ['danger', 'Essai terminé'], free: ['', 'Gratuit'] }[st.kind] || ['', ''];
    app.innerHTML = `
      <div class="header"><h1>Mon compte</h1></div>
      <div class="grid grid-2">
        <div class="card">
          <div class="row" style="gap:1rem">${badge({ icon: 'user', color: '#6c4cf5' }, 56)}<div><b style="font-size:1.15rem">${esc(p.name || '')}</b><div class="muted small">${esc(u.email || p.email || '')}</div></div><span class="grow"></span><span class="pill ${label[0]}">${label[1]}</span></div>
          <form id="f-acc" style="margin-top:.5rem"><label>Nom affiché</label><input name="name" value="${esc(p.name || '')}" maxlength="60" />
            <div class="row" style="margin-top:1rem"><button class="btn primary">${ic('check', 18)} Enregistrer</button><button type="button" class="btn danger" id="logout">Se déconnecter</button></div></form>
        </div>
        <div class="card violet">
          <h2>${ic('crown')} Mon abonnement</h2>
          ${st.kind === 'premium' ? `<p>Premium jusqu'au <b>${fmtDay(st.until)}</b>.</p>` : st.kind === 'trial' ? `<p>Essai gratuit jusqu'au <b>${fmtDay(st.until)}</b>.</p>` : st.kind === 'expired' ? '<p>Ton essai gratuit est terminé.</p>' : `<p>Compte gratuit. Tu peux essayer Premium ${CONFIG.trialDays} jours.</p>`}
          ${usage ? `<p class="small muted">IA aujourd'hui : ${usage.used} / ${usage.limit} demandes.</p>` : ''}
          <div class="row">${trialCta(st)}<a class="btn" href="#/premium">${ic('crown', 18)} Voir l'offre</a>${p.is_admin ? `<a class="btn primary" href="#/admin">${ic('settings', 18)} Administration</a>` : ''}</div>
        </div>
      </div>`;
    bindTrial();
    $('#f-acc').onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter || $('#f-acc button.primary'), async () => {
        const name = new FormData(e.target).get('name').trim();
        await Cloud.updateName(name);
        store.update((s) => (s.profile.name = name || s.profile.name));
        toast('Compte mis à jour');
        render();
      });
    };
    // Met à jour l'abonnement (ex. paiement validé entre-temps)
    if (!views.compte.fresh) {
      views.compte.fresh = true;
      Cloud.refreshProfile().then((np) => {
        if (JSON.stringify(np) !== JSON.stringify(p) && location.hash.startsWith('#/compte')) render();
      }).catch(() => {}).finally(() => setTimeout(() => (views.compte.fresh = false), 2000));
    }
    $('#logout').onclick = async () => {
      await Cloud.signOut();
      toast('Tu es déconnecté');
      render();
    };
    return;
  }

  const titles = { connexion: 'Connexion', inscription: 'Créer un compte', oubli: 'Mot de passe oublié' };
  app.innerHTML = `
    <div class="card" style="max-width:460px;margin:2rem auto;padding:2rem">
      <div style="text-align:center"><span class="logo" style="width:56px;height:56px;margin:0 auto .8rem;border-radius:16px">${ic('cap', 30)}</span>
      <h1>${titles[mode] || titles.connexion}</h1>
      <p class="muted small">${mode === 'inscription' ? `Gratuit. L'IA est incluse et tu peux essayer Premium ${CONFIG.trialDays} jours.` : mode === 'oubli' ? 'On t’envoie un lien pour choisir un nouveau mot de passe.' : 'Retrouve ton IA et ton abonnement.'}</p></div>
      <form id="f-auth">
        ${mode === 'inscription' ? '<label>Prénom</label><input name="name" required maxlength="60" autocomplete="given-name" />' : ''}
        <label>E-mail</label><input name="email" type="email" required autocomplete="email" />
        ${mode !== 'oubli' ? `<label>Mot de passe</label><input name="password" type="password" required minlength="6" autocomplete="${mode === 'inscription' ? 'new-password' : 'current-password'}" />` : ''}
        <button class="btn primary lg" style="width:100%;margin-top:1.2rem">${mode === 'inscription' ? 'Créer mon compte' : mode === 'oubli' ? 'Envoyer le lien' : 'Se connecter'}</button>
      </form>
      <div class="row small" style="justify-content:center;margin-top:1rem;gap:1rem">
        ${mode !== 'connexion' ? '<a href="#/compte/connexion">J’ai déjà un compte</a>' : '<a href="#/compte/inscription">Créer un compte</a>'}
        ${mode !== 'oubli' ? '<a href="#/compte/oubli">Mot de passe oublié ?</a>' : ''}
      </div>
    </div>`;
  const form = $('#f-auth');
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    busy(form.querySelector('button'), async () => {
      if (mode === 'inscription') {
        const r = await Cloud.signUp(f.email.trim(), f.password, f.name.trim());
        if (!r.confirmed) {
          form.outerHTML = `<div class="banner">${ic('checkCircle', 22)}<span>Compte créé ! Ouvre l'e-mail de confirmation envoyé à <b>${esc(f.email)}</b>, puis reviens te connecter.</span></div>`;
          return;
        }
        store.update((s) => (s.profile.name = s.profile.name || f.name.trim()));
        toast('Bienvenue sur StudyFlow !');
        location.hash = '#/';
      } else if (mode === 'oubli') {
        await Cloud.recover(f.email.trim());
        form.outerHTML = `<div class="banner">${ic('checkCircle', 22)}<span>Si un compte existe pour cet e-mail, un lien vient d'être envoyé.</span></div>`;
      } else {
        await Cloud.signIn(f.email.trim(), f.password);
        const name = Cloud.getProfile()?.name;
        store.update((s) => (s.profile.name = s.profile.name || name || ''));
        toast('Connecté', name ? `Content de te revoir, ${name} !` : '');
        location.hash = '#/';
      }
    }, 'Patiente…');
  };
};

function passwordModal() {
  modal(`<h2>${ic('lock')} Nouveau mot de passe</h2>
    <form id="f-pw"><label>Mot de passe (6 caractères minimum)</label><input name="password" type="password" minlength="6" required autocomplete="new-password" />
    <div class="row" style="margin-top:1.2rem;justify-content:flex-end"><button class="btn primary">${ic('check', 18)} Enregistrer</button></div></form>`, (dlg) => {
    $('#f-pw', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await Cloud.updatePassword(new FormData(e.target).get('password'));
        dlg.close();
        toast('Mot de passe modifié');
      } catch (err) {
        toast('Oups', err.message);
      }
    };
  });
}

// ---------- Administration (validation des paiements) ----------
views.admin = async (tab = 'pending') => {
  if (!cloudEnabled() || !Cloud.getProfile()?.is_admin) {
    app.innerHTML = `<div class="card">${emptyState('lock', 'Page réservée à l’administrateur.')}</div>`;
    return;
  }
  app.innerHTML = `
    <div class="header"><h1>Administration</h1><div class="muted">Valide les paiements pour activer les abonnements.</div></div>
    <div class="grid grid-4" id="stats" style="margin-bottom:1.1rem"></div>
    <div class="tabs">${[['pending', 'clock', 'À valider'], ['approved', 'check', 'Validés'], ['rejected', 'x', 'Refusés']].map(([k, i, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${ic(i, 18)} ${l}</button>`).join('')}</div>
    <div class="card" id="pay-list"><span class="spinner"></span> Chargement…</div>`;
  $$('[data-t]').forEach((b) => (b.onclick = () => (location.hash = `#/admin/${b.dataset.t}`)));
  try {
    const [stats, pays] = await Promise.all([Cloud.adminStats(), Cloud.adminPayments(tab)]);
    $('#stats').innerHTML = [['user', stats.users, 'inscrits', '#3aa6e0'], ['crown', stats.premium, 'abonnés', '#6c4cf5'], ['clock', stats.pending, 'paiements à valider', '#d98a1c'], ['chart', `${stats.revenue_month}`, `${CONFIG.currency} ce mois-ci`, '#15936b']]
      .map(([i, v, l, c]) => `<div class="card stat-card" style="margin:0">${badge({ icon: i, color: c }, 44)}<div><div class="stat">${v}</div><div class="small muted">${l}</div></div></div>`).join('');
    $('#pay-list').innerHTML = pays.length ? `<ul class="list">${pays.map((p) => `
      <li><span class="grow"><b>${esc(p.profiles?.name || '')}</b> <span class="small muted">${esc(p.profiles?.email || '')}</span>
        <div class="small"><b>${p.amount} ${CONFIG.currency}</b> · ${esc(p.plan)} (${p.days} j) · ${esc(p.method)} · transaction <b>${esc(p.reference)}</b>${p.phone ? ` · tél. ${esc(p.phone)}` : ''}</div>
        <div class="small muted">${new Date(p.created_at).toLocaleString('fr-FR')}${p.profiles?.premium_until ? ` · Premium jusqu'au ${fmtDay(p.profiles.premium_until)}` : ''}</div></span>
        ${p.status === 'pending' ? `<button class="btn sm primary" data-ok="${p.id}" data-days="${p.days}">${ic('check', 16)} Valider</button><button class="btn sm danger" data-no="${p.id}">${ic('x', 16)} Refuser</button>` : `<span class="pill ${PAY_STATUS[p.status][0]}">${PAY_STATUS[p.status][1]}</span>`}</li>`).join('')}</ul>`
      : emptyState('checkCircle', tab === 'pending' ? 'Aucun paiement à valider.' : 'Rien ici pour l’instant.');
    $$('[data-ok]').forEach((b) => (b.onclick = () => busy(b, async () => {
      await Cloud.approvePayment(b.dataset.ok, Number(b.dataset.days));
      toast('Paiement validé', 'Abonnement activé.');
      render();
    }, '…')));
    $$('[data-no]').forEach((b) => (b.onclick = () => {
      if (!confirm('Refuser ce paiement ?')) return;
      busy(b, async () => {
        await Cloud.rejectPayment(b.dataset.no);
        render();
      }, '…');
    }));
  } catch (e) {
    $('#pay-list').innerHTML = `<p style="color:var(--danger)">${esc(e.message)}</p>`;
  }
};

// ---------- Paramètres ----------
views.parametres = () => {
  const s = S();
  app.innerHTML = `
    <div class="header"><h1>Paramètres</h1></div>
    <div class="grid grid-2">
    <div class="card">
      <h2>${ic('user')} Profil</h2>
      <form id="f-profile">
        <label>Prénom</label><input name="name" value="${esc(s.profile.name)}" />
        <label>Langue des explications</label>
        <select name="lang">${[['fr', 'Français'], ['ar', 'العربية (arabe)'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${s.settings.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary" style="margin-top:1rem">${ic('check', 18)} Enregistrer</button>
      </form>
    </div>
    <div class="card">
      <h2>${ic('bell')} Rappels</h2>
      <p class="small muted">Les rappels arrivent tant qu'un onglet StudyFlow est ouvert. Échéances : 3 jours, 1 jour et 3 heures avant.</p>
      <form id="f-notif">
        <label>Me prévenir avant un cours (minutes)</label>
        <input name="leads" value="${esc((s.settings.leads || []).join(', '))}" placeholder="60, 15" />
        <div class="row" style="margin-top:1rem"><button class="btn primary">${ic('check', 18)} Enregistrer</button>
          <button type="button" class="btn ${s.settings.notifications ? 'done' : ''}" id="notif-toggle">${ic('bell', 18)} ${s.settings.notifications ? 'Notifications activées' : 'Activer les notifications'}</button></div>
      </form>
    </div>
    </div>
    ${cloudEnabled() ? `<div class="card violet">
      <h2>${ic('sparkles')} Intelligence artificielle</h2>
      <p class="small muted">L'IA est incluse avec ton compte StudyFlow : résumé détaillé, correction, indices, « Explique-moi » et, en Premium, TP/TD corrigés.</p>
      <a class="btn ${Cloud.user() ? '' : 'ai'}" href="#/compte">${ic('user', 18)} ${Cloud.user() ? 'Mon compte' : 'Se connecter'}</a>
    </div>` : `<div class="card violet">
      <h2>${ic('sparkles')} Intelligence artificielle</h2>
      <p class="small muted">Sans clé : analyse automatique des PDF, fiches, emploi du temps et rappels. Avec une clé API Claude (Anthropic) : résumé détaillé du cours, correction des exercices, indices, « Explique-moi » et TP/TD corrigés.
      Crée ta clé sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Elle reste <b>uniquement dans ce navigateur</b>.</p>
      <form id="f-ai">
        <div class="form-row">
          <div><label>Clé API</label><input name="apiKey" type="password" value="${esc(s.settings.apiKey)}" placeholder="sk-ant-…" autocomplete="off" /></div>
          <div><label>Modèle</label>
          <select name="model">${[['claude-sonnet-5-5', 'Claude Sonnet 5.5 (recommandé)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (rapide, économique)'], ['claude-opus-5-5', 'Claude Opus 5.5 (le plus puissant)']].map(([v, l]) => `<option value="${v}" ${s.settings.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div class="row" style="margin-top:1rem"><button class="btn primary">${ic('check', 18)} Enregistrer</button><button type="button" class="btn ai" id="test-ai">${ic('sparkles', 18)} Tester la clé</button></div>
      </form>
    </div>`}
    <div class="card">
      <h2>${ic('download')} Mes données</h2>
      <p class="small muted">Tout est stocké dans ce navigateur. Exporte une sauvegarde pour changer d'appareil.</p>
      <div class="row"><button class="btn" id="export">${ic('download', 18)} Exporter</button><button class="btn" id="import">${ic('upload', 18)} Importer</button><input type="file" id="import-file" accept=".json" hidden />
        <button class="btn sky" id="demo">${ic('sparkles', 18)} Charger un exemple</button><button class="btn danger" id="wipe">${ic('trash', 18)} Tout effacer</button></div>
    </div>`;

  $('#f-profile').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    store.update((st) => {
      st.profile.name = f.name.trim();
      st.settings.lang = f.lang;
    });
    toast('Profil enregistré');
  };
  if ($('#f-ai')) $('#f-ai').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    store.update((st) => Object.assign(st.settings, { apiKey: f.apiKey.trim(), model: f.model }));
    toast('Paramètres IA enregistrés');
  };
  if ($('#test-ai')) $('#test-ai').onclick = (e) => busy(e.currentTarget, async () => {
    const f = Object.fromEntries(new FormData($('#f-ai')));
    store.update((st) => Object.assign(st.settings, { apiKey: f.apiKey.trim(), model: f.model }));
    const r = await AI.ping();
    toast('La clé fonctionne', r);
  }, 'Test…');
  $('#f-notif').onsubmit = (e) => {
    e.preventDefault();
    const leads = new FormData(e.target).get('leads').split(/[,;\s]+/).map(Number).filter((n) => n > 0 && n < 1440);
    store.update((st) => (st.settings.leads = leads.length ? leads : [60, 15]));
    toast('Rappels enregistrés');
  };
  $('#notif-toggle').onclick = () => {
    if (s.settings.notifications) {
      store.update((st) => (st.settings.notifications = false));
      render();
    } else enableNotifications();
  };
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify({ ...S(), settings: { ...S().settings, apiKey: '' } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `studyflow-sauvegarde-${store.dayKey(new Date())}.json`;
    a.click();
  };
  $('#import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.subjects)) throw new Error('Fichier invalide');
      const key = S().settings.apiKey;
      store.replaceAll(data);
      store.update((st) => (st.settings.apiKey = st.settings.apiKey || key));
      toast('Sauvegarde importée');
      render();
    } catch (err) {
      toast('Import impossible', err.message);
    }
  };
  $('#demo').onclick = async () => {
    if (S().subjects.length && !confirm("Ajouter les données d'exemple à tes données actuelles ?")) return;
    const { loadDemo } = await import('./demo.js');
    loadDemo(store);
    toast('Exemple chargé', 'Va voir ton tableau de bord !');
    location.hash = '#/';
  };
  $('#wipe').onclick = () => {
    if (!confirm('Effacer définitivement toutes tes données StudyFlow de ce navigateur ?')) return;
    store.reset();
    location.hash = '#/';
    render();
  };
};

// ---------- Routeur ----------
function render() {
  const [, route = '', ...args] = location.hash.replace(/^#/, '').split('/');
  const name = views[route] ? route : 'dashboard';
  $$('#nav a').forEach((a) => {
    const nav = a.dataset.nav;
    a.classList.toggle('active', nav === name || (nav === 'matieres' && ['matiere', 'doc', 'exo'].includes(name)));
  });
  views[name](...args);
}

let lastHash = location.hash;
async function init() {
  if (cloudEnabled()) {
    try {
      const r = await Cloud.handleRedirect();
      if (r?.error) toast('Lien invalide ou expiré', r.error);
      else if (r?.type === 'recovery') setTimeout(passwordModal, 300);
      else if (r) toast('E-mail confirmé', 'Bienvenue sur StudyFlow !');
      if (Cloud.user() && !r) Cloud.refreshProfile().then(render).catch(() => {});
      const name = Cloud.getProfile()?.name;
      if (name && !S().profile.name) store.update((st) => (st.profile.name = name));
    } catch (e) {
      console.error(e);
    }
  }
  render();
}

window.addEventListener('hashchange', () => {
  render();
  if (location.hash.split('/')[1] !== lastHash.split('/')[1] || !location.hash.includes(lastHash.split('/')[2] || '§')) window.scrollTo(0, 0);
  lastHash = location.hash;
});
init();

// Horloge, minuteur et vérification des rappels
function clock() {
  const now = new Date();
  $('#clock').innerHTML = `${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}<b>${fmtTime(now)}</b>`;
}
clock();
setInterval(clock, 15000);
setInterval(focusTick, 1000);
setTimeout(() => tick(), 1500);
setInterval(() => tick(), 30000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
