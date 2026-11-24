import * as store from './store.js';
import * as AI from './ai.js';
import { extractText, localAnalysis, localSplitExercises } from './analyze.js';
import { DAYS, upcoming, todaysClasses, relTime, subjectOf, tick, setNotifier } from './reminders.js';

const S = () => store.get();
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
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<div class="small" style="white-space:pre-line">${esc(body)}</div>` : ''}`;
  el.title = 'Clique pour fermer';
  el.onclick = () => el.remove();
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function notify(title, body) {
  toast(title, body, 12000);
  if (S().settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎓</text></svg>' });
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

async function busy(btn, fn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Patiente…`;
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast('Oups', e.message || String(e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = label;
  }
}

const fmtTime = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (d) => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569'];
const EMOJIS = ['🐍', '🗄️', '📐', '🌐', '🧮', '⚛️', '🧪', '📖', '💻', '🧬', '📊', '🏛️', '🗣️', '🎨'];

function subjectOptions(selected) {
  return S().subjects.map((s) => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.emoji)} ${esc(s.name)}</option>`).join('');
}

function needSubjects() {
  return `<div class="empty"><div class="big">📚</div><p>Ajoute d'abord une matière.</p><a class="btn primary" href="#/matieres">Créer une matière</a></div>`;
}

// ---------- Vues ----------
const views = {};

views.dashboard = () => {
  const s = S();
  const now = new Date();
  if (!s.profile.name) {
    app.innerHTML = `
      <div class="card" style="max-width:520px;margin:3rem auto;text-align:center">
        <div style="font-size:3rem">🎓</div>
        <h1>Bienvenue sur StudyFlow</h1>
        <p class="muted">Ton assistant d'étude : cours analysés, exercices guidés, emploi du temps et rappels intelligents.</p>
        <form id="f-name" class="row" style="justify-content:center;margin-top:1rem">
          <input name="name" placeholder="Ton prénom" required style="max-width:220px" autofocus />
          <button class="btn primary">Commencer</button>
        </form>
        <p class="small muted" style="margin-top:1rem">Tes données restent dans ton navigateur. Aucun compte n'est nécessaire.</p>
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
  const next = upcoming(6, now);
  const pending = s.exercises.filter((e) => e.status !== 'done');
  const streak = store.streak();
  const doneCount = s.exercises.filter((e) => e.status === 'done').length;

  // Conseil intelligent : prochain cours dans moins de 3 h
  const soon = next.find((i) => i.kind === 'cours' && i.date - now < 3 * 3600000);
  const tip = soon
    ? (() => {
        const lines = [`Ton cours de <b>${esc(soon.subject.name)}</b> commence ${relTime(soon.date, now)}.`];
        const doc = s.docs.filter((d) => d.subjectId === soon.ev.subjectId && d.kind === 'cours').sort((a, b) => b.createdAt - a.createdAt)[0];
        if (doc) lines.push(`📚 Révise <a href="#/doc/${doc.id}">${esc(doc.name)}</a> pendant 15 min avant.`);
        const p = pending.filter((e) => e.subjectId === soon.ev.subjectId);
        if (p.length) lines.push(`📝 ${p.length} exercice(s) non terminé(s) : <a href="#/exo/${p[0].id}">continuer</a>.`);
        return `<div class="banner">🧠 ${lines.join('<br>')}</div>`;
      })()
    : '';

  app.innerHTML = `
    <div class="header">
      <h1>${hello} ${esc(s.profile.name)} 👋</h1>
      <div class="muted">${now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · voici ton programme.</div>
    </div>
    ${tip}
    ${!s.settings.notifications ? `<div class="banner">🔔 Active les notifications pour être prévenu avant tes cours. <button class="btn sm primary" id="enable-notif">Activer</button></div>` : ''}
    <div class="grid grid-2">
      <div class="card">
        <h2>📅 Aujourd'hui</h2>
        ${today.length ? `<ul class="list">${today.map((e) => {
          const sub = subjectOf(e.subjectId);
          const st = toMin(e.start), en = toMin(e.end || e.start);
          const state = nowMin >= en ? '<span class="pill">terminé</span>' : nowMin >= st ? '<span class="pill ok">en cours</span>' : '';
          return `<li><span class="time">${e.start}</span><span class="grow">${esc(sub.emoji)} ${esc(sub.name)} ${e.room ? `<span class="muted small">· ${esc(e.room)}</span>` : ''}</span>${state}</li>`;
        }).join('')}</ul>` : `<p class="muted">Pas de cours aujourd'hui. ${s.events.length ? '' : '<a href="#/planning">Ajoute ton emploi du temps</a>.'}</p>`}
      </div>
      <div class="card">
        <h2>🔔 Prochains événements</h2>
        ${next.length ? `<ul class="list">${next.map((i) => {
          const icon = i.kind === 'cours' ? '📘' : i.kind === 'examen' ? '⚠️' : '📝';
          const label = i.kind === 'cours' ? `Cours de ${esc(i.subject.name)}` : `${esc(i.dl.title)} <span class="muted small">(${esc(i.subject.name)})</span>`;
          const urgent = i.date - now < (i.kind === 'cours' ? 3600000 : 3 * 86400000);
          return `<li><span>${icon}</span><span class="grow">${label}</span><span class="pill ${urgent ? 'warn' : ''}">${relTime(i.date, now)}</span></li>`;
        }).join('')}</ul>` : `<p class="muted">Rien de prévu. Ajoute tes cours et tes examens dans <a href="#/planning">Emploi du temps</a>.</p>`}
      </div>
      <div class="card">
        <h2>📊 Ta progression</h2>
        ${s.subjects.length ? s.subjects.map((sub) => {
          const p = store.subjectProgress(sub.id);
          return `<div style="margin-bottom:.75rem"><div class="row spread small"><span>${esc(sub.emoji)} ${esc(sub.name)}</span><span class="muted">${p ? `${p.done}/${p.total} · ${p.pct}%` : 'aucun exercice'}</span></div>
            <div class="progress" style="--c:${sub.color}"><div style="width:${p ? p.pct : 0}%"></div></div></div>`;
        }).join('') : needSubjects()}
      </div>
      <div class="card">
        <h2>🏆 Ta motivation</h2>
        <div class="row" style="gap:2rem">
          <div><div class="stat">🔥 ${streak}</div><div class="muted small">jour${streak > 1 ? 's' : ''} de suite</div></div>
          <div><div class="stat">✅ ${doneCount}</div><div class="muted small">exercices réussis</div></div>
          <div><div class="stat">📄 ${s.docs.length}</div><div class="muted small">documents</div></div>
        </div>
        ${pending.length ? `<h3>À terminer</h3><ul class="list">${pending.slice(0, 4).map((e) => `<li><span class="grow">${esc(subjectOf(e.subjectId).emoji)} ${esc(e.title)}</span><a class="btn sm" href="#/exo/${e.id}">Continuer</a></li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  $('#enable-notif')?.addEventListener('click', enableNotifications);
};

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function enableNotifications() {
  if (!('Notification' in window)) return toast('Ton navigateur ne gère pas les notifications', 'Les rappels s’afficheront dans la page.');
  const perm = await Notification.requestPermission();
  store.update((s) => (s.settings.notifications = perm === 'granted'));
  toast(perm === 'granted' ? '🔔 Notifications activées' : 'Notifications refusées', perm === 'granted' ? 'Garde un onglet StudyFlow ouvert pour recevoir les rappels.' : 'Tu peux les réactiver dans les réglages du navigateur.');
  render();
}

views.matieres = () => {
  const s = S();
  app.innerHTML = `
    <div class="header row spread"><div><h1>📚 Mes matières</h1><div class="muted">Clique sur une matière pour déposer tes cours et tes séries.</div></div>
      <button class="btn primary" id="add-sub">+ Nouvelle matière</button></div>
    ${s.subjects.length ? `<div class="grid grid-3">${s.subjects.map((sub) => {
      const nc = s.docs.filter((d) => d.subjectId === sub.id && d.kind === 'cours').length;
      const ne = s.exercises.filter((e) => e.subjectId === sub.id).length;
      const p = store.subjectProgress(sub.id);
      return `<a class="card subject-card" style="--c:${sub.color}" href="#/matiere/${sub.id}">
        <div class="subject-emoji">${esc(sub.emoji)}</div><h2 style="margin:.3rem 0">${esc(sub.name)}</h2>
        <div class="muted small">${nc} cours · ${ne} exercices</div>
        <div class="progress" style="margin-top:.6rem;--c:${sub.color}"><div style="width:${p ? p.pct : 0}%"></div></div></a>`;
    }).join('')}</div>` : `<div class="card empty"><div class="big">📚</div><p>Aucune matière pour l'instant.</p><p class="small">Exemples : Python, Mathématiques, Bases de données, Réseaux…</p></div>`}`;
  $('#add-sub').onclick = () => subjectForm();
};

function subjectForm(sub) {
  const editing = !!sub;
  sub = sub || { name: '', emoji: EMOJIS[S().subjects.length % EMOJIS.length], color: COLORS[S().subjects.length % COLORS.length] };
  modal(`
    <h2>${editing ? 'Modifier la matière' : 'Nouvelle matière'}</h2>
    <form id="f-sub">
      <label>Nom</label><input name="name" value="${esc(sub.name)}" required placeholder="ex. Programmation Python" />
      <div class="form-row">
        <div><label>Emoji</label><select name="emoji">${EMOJIS.map((e) => `<option ${e === sub.emoji ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
        <div><label>Couleur</label><input type="color" name="color" value="${sub.color}" style="height:42px;padding:.2rem" /></div>
      </div>
      <div class="row" style="margin-top:1.25rem;justify-content:flex-end">
        <button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button>
      </div>
    </form>`, (dlg) => {
    $('#f-sub', dlg).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
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
  const dls = s.deadlines.filter((d) => d.subjectId === id).sort((a, b) => a.due.localeCompare(b.due));

  app.innerHTML = `
    <div class="header row spread">
      <div><a href="#/matieres" class="small">← Mes matières</a><h1>${esc(sub.emoji)} ${esc(sub.name)}</h1></div>
      <div class="row"><button class="btn sm" id="edit-sub">Modifier</button><button class="btn sm danger" id="del-sub">Supprimer</button></div>
    </div>
    <div class="tabs">
      <button data-tab="cours" class="${tab === 'cours' ? 'active' : ''}">📄 Cours</button>
      <button data-tab="series" class="${tab === 'series' ? 'active' : ''}">📝 Séries & exercices</button>
      <button data-tab="echeances" class="${tab === 'echeances' ? 'active' : ''}">⏰ Devoirs & examens</button>
    </div>
    <div id="tab-body"></div>`;

  const body = $('#tab-body');
  if (tab === 'echeances') {
    body.innerHTML = `<div class="card">${deadlineList(dls)}<button class="btn primary" id="add-dl">+ Ajouter un devoir / examen</button></div>`;
    $('#add-dl').onclick = () => deadlineForm(id);
    bindDeadlineList(body);
  } else {
    const isSerie = tab === 'series';
    body.innerHTML = `
      <div class="card">
        <div class="dropzone" id="drop">
          <div style="font-size:2rem">${isSerie ? '📝' : '📄'}</div>
          <b>Dépose ${isSerie ? 'ta série d’exercices' : 'ton cours'} ici</b> (PDF ou texte) ou clique pour choisir un fichier
          <div class="small">${AI.hasAI() ? '🤖 Analyse par IA activée' : '⚙️ Analyse locale (ajoute une clé API dans Paramètres pour une analyse par IA plus complète)'}</div>
        </div>
        <input type="file" id="file" accept=".pdf,.txt,.md,.py,.sql,.c,.java,.js" hidden />
        <details style="margin-top:.75rem"><summary class="small muted" style="cursor:pointer">…ou colle le texte directement</summary>
          <input id="paste-name" placeholder="Titre (ex. Chapitre 3 — Fonctions)" style="margin-top:.5rem" />
          <textarea id="paste-text" placeholder="Colle ici le contenu"></textarea>
          <button class="btn" id="paste-go" style="margin-top:.5rem">Analyser ce texte</button>
        </details>
        <div id="upload-status" class="small" style="margin-top:.5rem"></div>
      </div>
      ${isSerie ? exerciseList(exs, docs) : docList(docs)}`;
    bindUpload(id, isSerie ? 'serie' : 'cours');
  }

  $$('.tabs button').forEach((b) => (b.onclick = () => (location.hash = `#/matiere/${id}/${b.dataset.tab}`)));
  $('#edit-sub').onclick = () => subjectForm(sub);
  $('#del-sub').onclick = () => {
    if (!confirm(`Supprimer « ${sub.name} » et tous ses documents, exercices et cours de l'emploi du temps ?`)) return;
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
  if (!docs.length) return `<div class="card empty"><div class="big">📄</div><p>Aucun cours pour l'instant. Dépose ton premier PDF ci-dessus.</p></div>`;
  return `<div class="card"><h2>Mes cours</h2><ul class="list">${docs.map((d) => `
    <li><span>📄</span><span class="grow"><a href="#/doc/${d.id}"><b>${esc(d.name)}</b></a><div class="muted small">${new Date(d.createdAt).toLocaleDateString('fr-FR')} · ${d.analysisMode === 'ai' ? '🤖 analysé par IA' : '⚙️ analyse locale'}</div></span>
    <a class="btn sm" href="#/doc/${d.id}">Ouvrir</a></li>`).join('')}</ul></div>`;
}

function exerciseList(exs, series) {
  if (!exs.length) return `<div class="card empty"><div class="big">📝</div><p>Aucun exercice. Dépose une série ci-dessus : StudyFlow détecte chaque exercice.</p></div>`;
  return series.map((sr) => {
    const list = exs.filter((e) => e.docId === sr.id).sort((a, b) => a.num - b.num);
    if (!list.length) return '';
    const done = list.filter((e) => e.status === 'done').length;
    return `<div class="card"><div class="row spread"><h2 style="margin:0">📝 ${esc(sr.name)}</h2><span class="row"><span class="pill ${done === list.length ? 'ok' : ''}">${done}/${list.length}</span><button class="btn sm ghost danger" data-del-serie="${sr.id}" title="Supprimer la série">🗑</button></span></div>
      <ul class="list">${list.map((e) => `<li><span>${e.status === 'done' ? '✅' : e.answer ? '🟡' : '⬜'}</span><span class="grow">${esc(e.title)}</span><a class="btn sm" href="#/exo/${e.id}">${e.status === 'done' ? 'Revoir' : 'Résoudre'}</a></li>`).join('')}</ul></div>`;
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
      status.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
    }
  }

  async function ingest(name, text) {
    const sub = subjectOf(subjectId);
    const lang = S().settings.lang;
    const doc = { id: store.uid(), subjectId, kind, name, text, createdAt: Date.now() };
    try {
      if (kind === 'cours') {
        status.innerHTML = `<span class="spinner"></span> ${AI.hasAI() ? "L'IA analyse ton cours (30 s environ)…" : 'Analyse du cours…'}`;
        doc.analysis = await analyzeDoc(text, sub.name, lang, doc);
      } else {
        status.innerHTML = `<span class="spinner"></span> Détection des exercices…`;
        let list;
        if (AI.hasAI()) {
          try {
            list = (await AI.splitExercises(text, lang)).exercises;
          } catch (e) {
            toast("L'IA n'a pas pu découper la série", e.message + ' · découpage local utilisé.');
          }
        }
        if (!list?.length) list = localSplitExercises(text);
        store.update((s) => {
          list.forEach((x, i) =>
            s.exercises.push({ id: store.uid(), docId: doc.id, subjectId, num: i + 1, title: x.title || `Exercice ${i + 1}`, statement: x.statement, status: 'todo', answer: '', hints: [], feedback: '', solution: '' }),
          );
        });
        toast(`✅ ${list.length} exercice(s) détecté(s)`, name);
      }
      store.update((s) => {
        s.docs.push(doc);
        store.logActivity();
      });
      if (kind === 'cours') location.hash = `#/doc/${doc.id}`;
      else render();
    } catch (e) {
      console.error(e);
      status.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message)}</span>`;
    }
  }
}

async function analyzeDoc(text, subjectName, lang, doc) {
  if (AI.hasAI()) {
    try {
      const a = await AI.analyzeCourse(text, subjectName, lang);
      doc.analysisMode = 'ai';
      return a;
    } catch (e) {
      toast("L'analyse IA a échoué", `${e.message}\nAnalyse locale utilisée à la place.`, 10000);
    }
  }
  doc.analysisMode = 'local';
  return localAnalysis(text);
}

views.doc = (id, tab = 'analyse') => {
  const s = S();
  const doc = s.docs.find((d) => d.id === id);
  if (!doc) return (location.hash = '#/matieres');
  const sub = subjectOf(doc.subjectId);
  const a = doc.analysis || {};
  app.innerHTML = `
    <div class="header row spread">
      <div><a href="#/matiere/${doc.subjectId}" class="small">← ${esc(sub.emoji)} ${esc(sub.name)}</a><h1>📄 ${esc(doc.name)}</h1>
      <div class="muted small">${doc.analysisMode === 'ai' ? '🤖 Analyse par IA' : '⚙️ Analyse locale automatique'}</div></div>
      <div class="row"><button class="btn sm" id="reanalyze">${AI.hasAI() ? '🤖 Analyser avec l’IA' : '🔄 Ré-analyser'}</button><button class="btn sm danger" id="del-doc">Supprimer</button></div>
    </div>
    <div class="tabs">
      <button data-tab="analyse" class="${tab === 'analyse' ? 'active' : ''}">🧠 Analyse</button>
      <button data-tab="explique" class="${tab === 'explique' ? 'active' : ''}">🧑‍🏫 Explique-moi</button>
      <button data-tab="texte" class="${tab === 'texte' ? 'active' : ''}">📃 Texte du cours</button>
    </div>
    <div id="tab-body"></div>`;
  const body = $('#tab-body');

  if (tab === 'analyse') {
    body.innerHTML = `
      <div class="card"><h2>📌 Résumé</h2>${md(a.summary)}</div>
      ${a.keyPoints?.length ? `<div class="card"><h2>⭐ À retenir</h2><div class="row">${a.keyPoints.map((k) => `<span class="pill">${esc(k)}</span>`).join('')}</div></div>` : ''}
      ${a.definitions?.length ? `<div class="card"><h2>📖 Définitions importantes</h2>${a.definitions.map((d) => `<div class="def"><b>${esc(d.term)}</b> : ${esc(d.definition)}</div>`).join('')}</div>` : ''}
      ${a.formulas?.length ? `<div class="card"><h2>🧮 Formules</h2>${a.formulas.map((f) => `<div class="formula">${esc(f.formula)}</div>${f.meaning ? `<div class="small muted" style="margin:-.2rem 0 .6rem .8rem">${esc(f.meaning)}</div>` : ''}`).join('')}</div>` : ''}
      ${a.codes?.length ? `<div class="card"><h2>💻 Codes à connaître</h2>${a.codes.map((c) => `<pre><code>${esc(c.code)}</code></pre>${c.explanation ? md(c.explanation) : ''}`).join('')}</div>` : ''}
      ${a.questions?.length ? `<div class="card"><h2>🧠 Questions possibles à l'examen</h2><ol>${a.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>` : ''}
      ${a.sheet ? `<div class="card"><h2>📝 Fiche de révision</h2>${md(a.sheet)}</div>` : ''}
      ${doc.analysisMode !== 'ai' ? `<div class="banner small">💡 L'analyse locale repère automatiquement formules, codes et définitions. Pour un vrai résumé expliqué, des explications de code et des questions d'examen ciblées, ajoute une clé API dans <a href="#/parametres">Paramètres</a> puis clique « Analyser avec l'IA ».</div>` : ''}`;
  } else if (tab === 'explique') {
    body.innerHTML = `
      <div class="card">
        <h2>🧑‍🏫 Je ne comprends pas cette partie…</h2>
        <p class="muted small">Colle ou sélectionne un passage dans l'onglet « Texte du cours », puis choisis comment tu veux qu'on te l'explique.</p>
        <textarea id="passage" placeholder="Colle ici le passage difficile">${esc(sessionStorage.getItem('sf:passage') || '')}</textarea>
        <div class="row" style="margin:.75rem 0">
          <label style="margin:0">Langue</label>
          <select id="lang" style="width:auto">${[['fr', 'Français'], ['ar', 'العربية'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${S().settings.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="row">${Object.entries(AI.EXPLAIN_MODES).map(([k, m]) => `<button class="btn" data-mode="${k}">${m.label}</button>`).join('')}</div>
        <div id="explain-out"></div>
      </div>`;
    sessionStorage.removeItem('sf:passage');
    $$('[data-mode]').forEach((b) => (b.onclick = () => busy(b, async () => {
      if (!AI.hasAI()) throw new Error("Le mode « Explique-moi » utilise l'IA : ajoute ta clé API dans Paramètres.");
      const passage = $('#passage').value.trim();
      if (!passage) throw new Error("Colle d'abord un passage du cours.");
      const lang = $('#lang').value;
      const out = await AI.explain(passage, b.dataset.mode, sub.name, lang);
      $('#explain-out').innerHTML = `<div class="feedback ai" ${lang === 'ar' ? 'dir="rtl"' : ''}>${md(out)}</div>`;
      store.update(store.logActivity);
    })));
  } else {
    body.innerHTML = `<div class="card"><div class="row spread"><p class="muted small" style="margin:0">Sélectionne un passage puis clique « Explique-moi ce passage ».</p><button class="btn sm primary" id="explain-sel">🧑‍🏫 Explique-moi ce passage</button></div>
      <div id="doc-text" style="white-space:pre-wrap;margin-top:1rem;font-size:.92rem">${esc(doc.text)}</div></div>`;
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
    render();
  });
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
  const siblings = s.exercises.filter((e) => e.docId === ex.docId).sort((a, b) => a.num - b.num);
  const idx = siblings.findIndex((e) => e.id === id);
  const prev = siblings[idx - 1], next = siblings[idx + 1];
  const lang = s.settings.lang;
  const looksCode = /python|code|fonction|programme|algorithme|sql|requête|script|java|c\+\+/i.test(sub.name + ' ' + ex.statement);

  app.innerHTML = `
    <div class="header">
      <a href="#/matiere/${ex.subjectId}/series" class="small">← ${esc(sub.emoji)} ${esc(sub.name)} · séries</a>
      <div class="row spread"><h1>${esc(ex.title)}</h1>${ex.status === 'done' ? '<span class="pill ok">✅ Réussi</span>' : ''}</div>
    </div>
    <div class="card"><h2>📋 Énoncé</h2><div style="white-space:pre-wrap">${esc(ex.statement)}</div></div>
    <div class="card">
      <h2>🟢 Je veux essayer seul</h2>
      <textarea id="answer" class="${looksCode ? 'code' : ''}" placeholder="Écris ta réponse ici (code, calcul, rédaction…)" style="min-height:180px">${esc(ex.answer)}</textarea>
      <div class="row" style="margin-top:.75rem">
        <button class="btn primary" id="check">🔎 Corriger ma réponse</button>
        <button class="btn" id="hint">💡 Indice ${ex.hints.length ? `(${ex.hints.length}/3)` : ''}</button>
        <button class="btn" id="sol">👀 Voir la solution</button>
        <button class="btn" id="done">${ex.status === 'done' ? '↩️ Marquer à refaire' : '✅ Je l’ai réussi'}</button>
      </div>
      ${!AI.hasAI() ? `<div class="banner small" style="margin-top:1rem">La correction, les indices et la solution utilisent l'IA. Ajoute ta clé API dans <a href="#/parametres">Paramètres</a>. Tu peux quand même écrire ta réponse (elle est sauvegardée) et marquer l'exercice comme réussi.</div>` : ''}
      ${ex.hints.map((h, i) => `<div class="feedback hint"><b>💡 Indice ${i + 1}</b>${md(h)}</div>`).join('')}
      ${ex.feedback ? `<div class="feedback ai"><b>🧑‍🏫 Correction</b>${md(ex.feedback)}</div>` : ''}
      ${ex.solution ? `<div class="feedback solution"><b>✅ Solution</b>${md(ex.solution)}</div>` : ''}
    </div>
    <div class="row spread">
      ${prev ? `<a class="btn" href="#/exo/${prev.id}">← ${esc(prev.title.slice(0, 30))}</a>` : '<span></span>'}
      ${next ? `<a class="btn" href="#/exo/${next.id}">${esc(next.title.slice(0, 30))} →</a>` : ''}
    </div>`;

  const ans = $('#answer');
  let t;
  ans.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => store.update((st) => (st.exercises.find((e) => e.id === id).answer = ans.value)), 400);
  };
  const saveAnswer = () => store.update((st) => (st.exercises.find((e) => e.id === id).answer = ans.value));
  const cur = () => S().exercises.find((e) => e.id === id);
  const requireAI = () => {
    if (!AI.hasAI()) throw new Error('Ajoute ta clé API dans Paramètres pour activer la correction par IA.');
  };

  $('#check').onclick = (e) => busy(e.currentTarget, async () => {
    requireAI();
    saveAnswer();
    if (!ans.value.trim()) throw new Error("Écris d'abord ta réponse : on la corrige ensemble ensuite.");
    const fb = await AI.correct(cur(), sub.name, lang);
    store.update((st) => {
      const x = st.exercises.find((e) => e.id === id);
      x.feedback = fb;
      x.attempts = (x.attempts || 0) + 1;
      if (/^\W*✅\s*Correct/i.test(fb.trim())) x.status = 'done';
      store.logActivity();
    });
    render();
  });
  $('#hint').onclick = (e) => busy(e.currentTarget, async () => {
    requireAI();
    saveAnswer();
    if (cur().hints.length >= 3) throw new Error('Tu as déjà les 3 indices. Essaie encore, ou affiche la solution.');
    const h = await AI.hint(cur(), sub.name, lang);
    store.update((st) => st.exercises.find((e) => e.id === id).hints.push(h));
    render();
  });
  $('#sol').onclick = (e) => {
    if (!cur().solution && !confirm("Tu es sûr ? Essayer encore un peu (ou demander un indice) t'aide à mieux retenir.")) return;
    busy(e.currentTarget, async () => {
      requireAI();
      saveAnswer();
      if (!cur().solution) {
        const sol = await AI.solution(cur(), sub.name, lang);
        store.update((st) => (st.exercises.find((e) => e.id === id).solution = sol));
      }
      render();
    });
  };
  $('#done').onclick = () => {
    saveAnswer();
    store.update((st) => {
      const x = st.exercises.find((e) => e.id === id);
      x.status = x.status === 'done' ? 'todo' : 'done';
      store.logActivity();
    });
    if (cur().status === 'done') toast('🎉 Bravo !', next ? 'On passe au suivant ?' : 'Série terminée !');
    render();
  };
};

// ---------- Emploi du temps ----------
function deadlineList(dls) {
  if (!dls.length) return `<p class="muted">Aucun devoir ni examen.</p>`;
  const now = new Date();
  return `<ul class="list">${dls.map((d) => {
    const due = new Date(d.due);
    const late = due < now && !d.done;
    return `<li><input type="checkbox" data-dl-done="${d.id}" ${d.done ? 'checked' : ''} style="width:auto" />
      <span class="grow" style="${d.done ? 'text-decoration:line-through;opacity:.6' : ''}">${d.type === 'examen' ? '⚠️' : '📝'} <b>${esc(d.title)}</b>
      <div class="muted small">${esc(subjectOf(d.subjectId).name)} · ${fmtDate(due)} ${fmtTime(due)}</div></span>
      <span class="pill ${late ? 'danger' : due - now < 3 * 86400000 ? 'warn' : ''}">${late ? 'en retard' : relTime(due, now)}</span>
      <button class="btn sm ghost" data-dl-del="${d.id}" title="Supprimer">🗑</button></li>`;
  }).join('')}</ul>`;
}

function bindDeadlineList(root) {
  $$('[data-dl-done]', root).forEach((c) => (c.onchange = () => {
    store.update((s) => {
      s.deadlines.find((d) => d.id === c.dataset.dlDone).done = c.checked;
      store.logActivity();
    });
    render();
  }));
  $$('[data-dl-del]', root).forEach((b) => (b.onclick = () => {
    store.update((s) => (s.deadlines = s.deadlines.filter((d) => d.id !== b.dataset.dlDel)));
    render();
  }));
}

function deadlineForm(subjectId) {
  if (!S().subjects.length) return toast('Ajoute d’abord une matière');
  const d = new Date(Date.now() + 7 * 86400000);
  d.setHours(9, 0, 0, 0);
  const local = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  modal(`
    <h2>Nouveau devoir / examen</h2>
    <form id="f-dl">
      <label>Titre</label><input name="title" required placeholder="ex. Examen de Python — chapitres 1 à 4" />
      <div class="form-row">
        <div><label>Type</label><select name="type"><option value="devoir">📝 Devoir</option><option value="examen">⚠️ Examen</option><option value="autre">📌 Autre</option></select></div>
        <div><label>Matière</label><select name="subjectId">${subjectOptions(subjectId)}</select></div>
      </div>
      <label>Date et heure</label><input type="datetime-local" name="due" value="${local}" required />
      <div class="row" style="margin-top:1.25rem;justify-content:flex-end"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Ajouter</button></div>
    </form>`, (dlg) => {
    $('#f-dl', dlg).onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      store.update((s) => s.deadlines.push({ id: store.uid(), ...f, done: false }));
      dlg.close();
      render();
    };
  });
}

function eventForm(day = 1) {
  if (!S().subjects.length) return toast('Ajoute d’abord une matière');
  modal(`
    <h2>Ajouter un cours à l'emploi du temps</h2>
    <form id="f-ev">
      <label>Matière</label><select name="subjectId">${subjectOptions()}</select>
      <div class="form-row">
        <div><label>Jour</label><select name="day">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${d === day ? 'selected' : ''}>${DAYS[d]}</option>`).join('')}</select></div>
        <div><label>Début</label><input type="time" name="start" value="08:00" required /></div>
        <div><label>Fin</label><input type="time" name="end" value="10:00" required /></div>
      </div>
      <label>Salle / lieu (optionnel)</label><input name="room" placeholder="ex. Amphi B" />
      <div class="row" style="margin-top:1.25rem;justify-content:flex-end"><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Ajouter</button></div>
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

/** Importe des lignes du type « Lundi 08:00-10:00 Python Amphi B ». Crée les matières manquantes. */
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
        sub = { id: store.uid(), name: name.trim(), emoji: EMOJIS[s.subjects.length % EMOJIS.length], color: COLORS[s.subjects.length % COLORS.length] };
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
    <div class="header row spread"><div><h1>📅 Emploi du temps</h1><div class="muted">StudyFlow te prévient ${(s.settings.leads || []).join(' et ')} min avant chaque cours.</div></div>
      <div class="row"><button class="btn" id="import">📋 Importer</button><button class="btn primary" id="add-ev">+ Ajouter un cours</button></div></div>
    <div class="week">${order.map((d) => {
      const evs = s.events.filter((e) => Number(e.day) === d).sort((a, b) => a.start.localeCompare(b.start));
      return `<div class="day-col ${d === now.getDay() ? 'today' : ''}"><h4>${DAYS[d]}</h4>
        ${evs.map((e) => {
          const sub = subjectOf(e.subjectId);
          return `<div class="slot" style="--c:${sub.color}"><button class="x" data-ev-del="${e.id}" title="Retirer">✕</button><b>${e.start}–${e.end}</b><br>${esc(sub.emoji)} ${esc(sub.name)}${e.room ? `<br><span style="opacity:.85">${esc(e.room)}</span>` : ''}</div>`;
        }).join('')}
        <button class="btn sm ghost" data-add-day="${d}" style="width:100%;justify-content:center">+</button></div>`;
    }).join('')}</div>
    <div class="card" style="margin-top:1rem"><div class="row spread"><h2 style="margin:0">⏰ Devoirs & examens</h2><button class="btn sm primary" id="add-dl">+ Ajouter</button></div>
      ${deadlineList([...s.deadlines].sort((a, b) => a.due.localeCompare(b.due)))}</div>
    <div class="card"><h2>🔔 Test des rappels</h2><p class="small muted">Vérifie à quoi ressemble un rappel pour ton prochain cours.</p><button class="btn" id="test-notif">Envoyer un rappel de test</button></div>`;

  $('#add-ev').onclick = () => eventForm();
  $('#add-dl').onclick = () => deadlineForm();
  $$('[data-add-day]').forEach((b) => (b.onclick = () => eventForm(Number(b.dataset.addDay))));
  $$('[data-ev-del]').forEach((b) => (b.onclick = () => {
    store.update((st) => (st.events = st.events.filter((e) => e.id !== b.dataset.evDel)));
    render();
  }));
  bindDeadlineList(app);
  $('#test-notif').onclick = async () => {
    if (s.settings.notifications === false && 'Notification' in window && Notification.permission === 'default') await enableNotifications();
    const nxt = upcoming(20).find((i) => i.kind === 'cours');
    if (!nxt) return notify('🔔 StudyFlow', 'Ajoute un cours à ton emploi du temps pour recevoir des rappels.');
    const { classMessage } = await import('./reminders.js');
    notify(`${nxt.subject.emoji} ${nxt.subject.name} · ${nxt.ev.start}`, classMessage(nxt.ev, nxt.date).join('\n'));
  };
  $('#import').onclick = () => modal(`
    <h2>📋 Importer l'emploi du temps</h2>
    <p class="small muted">Une ligne par cours : <code>Jour Début-Fin Matière, Salle</code>. Les matières manquantes sont créées automatiquement.</p>
    <textarea id="imp" class="code" style="min-height:160px" placeholder="Lundi 08:00-10:00 Python, Amphi A
Mardi 10h-12h Bases de données
Lundi 14:00-16:00 Mathématiques, Salle 12"></textarea>
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button class="btn" data-close>Annuler</button><button class="btn primary" id="imp-go">Importer</button></div>`, (dlg) => {
    $('#imp-go', dlg).onclick = () => {
      const { n, errors } = importSchedule($('#imp', dlg).value);
      dlg.close();
      toast(`✅ ${n} cours importé(s)`, errors.length ? `Lignes non comprises :\n${errors.slice(0, 5).join('\n')}` : '');
      render();
    };
  });
};

// ---------- Paramètres ----------
views.parametres = () => {
  const s = S();
  app.innerHTML = `
    <div class="header"><h1>⚙️ Paramètres</h1></div>
    <div class="card">
      <h2>👤 Profil</h2>
      <form id="f-profile">
        <label>Prénom</label><input name="name" value="${esc(s.profile.name)}" />
        <label>Langue des explications de l'IA</label>
        <select name="lang">${[['fr', 'Français'], ['ar', 'العربية (arabe)'], ['en', 'English']].map(([v, l]) => `<option value="${v}" ${s.settings.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn primary" style="margin-top:1rem">Enregistrer</button>
      </form>
    </div>
    <div class="card">
      <h2>🤖 Intelligence artificielle</h2>
      <p class="small muted">StudyFlow fonctionne sans IA (analyse locale des PDF, emploi du temps, rappels). Avec une clé API Claude (Anthropic), tu débloques : résumé expliqué du cours, explications des codes, questions d'examen, correction des exercices, indices et mode « Explique-moi ».
      Crée ta clé sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Elle est enregistrée <b>uniquement dans ce navigateur</b> et envoyée seulement à l'API d'Anthropic.</p>
      <form id="f-ai">
        <label>Clé API</label><input name="apiKey" type="password" value="${esc(s.settings.apiKey)}" placeholder="sk-ant-…" autocomplete="off" />
        <label>Modèle</label>
        <select name="model">${[['claude-sonnet-5-5', 'Claude Sonnet 5.5 (recommandé)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (rapide, moins cher)'], ['claude-opus-5-5', 'Claude Opus 5.5 (le plus puissant)']].map(([v, l]) => `<option value="${v}" ${s.settings.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="row" style="margin-top:1rem"><button class="btn primary">Enregistrer</button><button type="button" class="btn" id="test-ai">Tester la clé</button></div>
      </form>
    </div>
    <div class="card">
      <h2>🔔 Rappels</h2>
      <p class="small muted">Les rappels arrivent tant qu'un onglet StudyFlow est ouvert (même en arrière-plan). Les devoirs et examens sont rappelés 3 jours, 1 jour et 3 heures avant.</p>
      <form id="f-notif">
        <label>Me prévenir avant un cours (minutes, séparées par des virgules)</label>
        <input name="leads" value="${esc((s.settings.leads || []).join(', '))}" placeholder="60, 15" />
        <div class="row" style="margin-top:1rem"><button class="btn primary">Enregistrer</button>
          <button type="button" class="btn" id="notif-toggle">${s.settings.notifications ? '🔕 Désactiver les notifications' : '🔔 Activer les notifications'}</button></div>
      </form>
    </div>
    <div class="card">
      <h2>💾 Mes données</h2>
      <p class="small muted">Tout est stocké dans ce navigateur. Exporte une sauvegarde pour changer d'appareil.</p>
      <div class="row"><button class="btn" id="export">⬇️ Exporter</button><button class="btn" id="import">⬆️ Importer</button><input type="file" id="import-file" accept=".json" hidden />
        <button class="btn" id="demo">✨ Charger un exemple</button><button class="btn danger" id="wipe">Tout effacer</button></div>
    </div>`;

  $('#f-profile').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    store.update((st) => {
      st.profile.name = f.name.trim();
      st.settings.lang = f.lang;
    });
    toast('✅ Enregistré');
  };
  $('#f-ai').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    store.update((st) => Object.assign(st.settings, { apiKey: f.apiKey.trim(), model: f.model }));
    toast('✅ Paramètres IA enregistrés');
  };
  $('#test-ai').onclick = (e) => busy(e.currentTarget, async () => {
    const f = Object.fromEntries(new FormData($('#f-ai')));
    store.update((st) => Object.assign(st.settings, { apiKey: f.apiKey.trim(), model: f.model }));
    const r = await AI.ask({ system: 'Réponds en une phrase courte.', prompt: "Dis bonjour à un étudiant qui commence à utiliser StudyFlow.", maxTokens: 80 });
    toast('✅ La clé fonctionne', r);
  });
  $('#f-notif').onsubmit = (e) => {
    e.preventDefault();
    const leads = new FormData(e.target).get('leads').split(/[,;\s]+/).map(Number).filter((n) => n > 0 && n < 1440);
    store.update((st) => (st.settings.leads = leads.length ? leads : [60, 15]));
    toast('✅ Rappels enregistrés');
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
      toast('✅ Sauvegarde importée');
      render();
    } catch (err) {
      toast('Import impossible', err.message);
    }
  };
  $('#demo').onclick = async () => {
    if (S().subjects.length && !confirm("Ajouter les données d'exemple à tes données actuelles ?")) return;
    const { loadDemo } = await import('./demo.js');
    loadDemo(store);
    toast('✨ Exemple chargé', 'Va voir ton tableau de bord !');
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
  const name = route || 'dashboard';
  const view = views[name] || views.dashboard;
  $$('.sidebar nav a').forEach((a) => {
    const nav = a.dataset.nav;
    a.classList.toggle('active', nav === name || (nav === 'matieres' && ['matiere', 'doc', 'exo'].includes(name)));
  });
  view(...args);
  window.scrollTo?.(0, 0);
}

window.addEventListener('hashchange', render);
render();

// Horloge + vérification des rappels
function clock() {
  $('#clock').textContent = new Date().toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
}
clock();
setInterval(clock, 15000);
setTimeout(() => tick(), 1500);
setInterval(() => tick(), 30000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
