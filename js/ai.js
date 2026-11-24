// Appels à l'IA.
// - Avec Supabase configuré : passe par le serveur StudyFlow (clé cachée, Premium et quotas vérifiés).
// - Sinon : appel direct à l'API Claude avec la clé que l'étudiant colle dans Paramètres.
import { get } from './store.js';
import { cloudEnabled } from './config.js';
import * as Cloud from './cloud.js';
import { TASKS, parseJSON, EXPLAIN_MODES, GEN_TYPES } from './prompts.js';

export { EXPLAIN_MODES, GEN_TYPES };

export const mode = () => (cloudEnabled() ? 'cloud' : 'key');
export const hasAI = () => (cloudEnabled() ? !!Cloud.user() : !!get().settings.apiKey);
export const missingMessage = () =>
  cloudEnabled() ? "Connecte-toi (gratuit) pour utiliser l'IA." : "Ajoute ta clé IA dans Paramètres pour activer l'IA.";

async function direct(spec) {
  const { apiKey, model } = get().settings;
  if (!apiKey) throw new Error(missingMessage());
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: spec.maxTokens || 2500, system: spec.system, messages: [{ role: 'user', content: spec.prompt }] }),
  });
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try {
      const j = await res.json();
      msg += ` : ${j.error?.message || ''}`;
    } catch {}
    if (res.status === 401) msg = 'Clé API invalide. Vérifie-la dans Paramètres.';
    throw new Error(msg);
  }
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

async function run(task, params) {
  if (!hasAI()) throw new Error(missingMessage());
  const lang = params.lang || get().settings.lang;
  const p = { ...params, lang };
  const spec = TASKS[task](p);
  const text = cloudEnabled() ? await Cloud.runTask(task, p) : await direct(spec);
  return spec.json ? parseJSON(text) : text;
}

export const ping = () => run('ping', {});
export const analyzeCourse = (text, subject, lang) => run('analyze', { text, subject, lang });
export const splitExercises = (text, lang) => run('split', { text, lang });
export const correct = (ex, subject, lang) => run('correct', { statement: ex.statement, answer: ex.answer, subject, lang });
export const hint = (ex, subject, lang) => run('hint', { statement: ex.statement, answer: ex.answer, hints: ex.hints || [], subject, lang });
export const solution = (ex, subject, lang) => run('solution', { statement: ex.statement, subject, lang });
export const explain = (passage, m, subject, lang) => run('explain', { passage, mode: m, subject, lang });
export const generateSet = (text, subject, opts, lang) => run('generate', { text, subject, ...opts, lang });
