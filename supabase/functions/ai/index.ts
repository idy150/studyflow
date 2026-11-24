// @ts-nocheck
// =====================================================================
// StudyFlow : serveur IA (Supabase Edge Function « ai »)
// FICHIER GÉNÉRÉ par tools/build-function.mjs à partir de js/prompts.js : ne pas modifier à la main.
//
// - Vérifie que l'étudiant est connecté.
// - Vérifie l'accès Premium (essai ou abonnement) pour la génération de TP/TD.
// - Applique un quota d'appels par jour.
// - Appelle Claude avec TA clé (secret ANTHROPIC_API_KEY), jamais visible par les étudiants.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// ----- Prompts (copie de js/prompts.js) -----
// Prompts de l'IA. Fichier PARTAGÉ entre le site et le serveur (supabase/functions/ai).
// Après modification, lance : node tools/build-function.mjs
// (aucun import ici : le fichier doit fonctionner dans le navigateur ET dans Deno)

const LANG = { fr: 'en français', ar: 'en arabe (langue simple)', en: 'in English' };
const langInstruction = (lang) => `Réponds ${LANG[lang] || LANG.fr}.`;

const TUTOR = `Tu es StudyFlow, un tuteur bienveillant pour étudiants universitaires.
Tu expliques clairement, avec des exemples concrets. Tu utilises du Markdown simple (titres ###, listes, **gras**, blocs de code \`\`\`).`;

const MAX = 60000;
const clip = (t = '') => (t.length > MAX ? t.slice(0, MAX) + '\n[... texte tronqué ...]' : t);
const short = (t = '', n = 8000) => String(t).slice(0, n);

export const EXPLAIN_MODES = {
  simple: { label: 'Explique simplement', p: "Explique ce passage très simplement, comme à un débutant, avec une analogie de la vie courante." },
  univ: { label: 'Niveau universitaire', p: 'Explique ce passage de façon rigoureuse, niveau universitaire, avec le vocabulaire précis.' },
  example: { label: 'Donne un exemple', p: 'Donne un ou deux exemples concrets (code ou calcul si pertinent) qui illustrent ce passage.' },
  exercise: { label: 'Donne un exercice', p: "Propose un exercice d'entraînement sur ce passage, avec la solution cachée à la fin sous un titre « Solution »." },
  quiz: { label: 'Pose-moi des questions', p: "Pose 5 questions (QCM ou courtes) pour vérifier que j'ai compris ce passage. Mets les réponses à la fin sous un titre « Réponses »." },
  other: { label: 'Explique autrement', p: "Explique ce passage d'une manière différente : schéma en texte, étapes numérotées ou comparaison." },
};

export const GEN_TYPES = {
  td: { label: 'TD (exercices)', p: "un TD : exercices d'application progressifs (du plus simple au plus difficile) qui couvrent les notions clés du cours" },
  tp: { label: 'TP (pratique)', p: 'un TP : travail pratique guidé, en étapes concrètes (code, manipulation ou calcul selon la matière), avec un objectif clair et un résultat attendu' },
  exam: { label: 'Examen blanc', p: 'un examen blanc réaliste : questions de cours, exercices et un problème de synthèse, avec un barème sur 20 dans le titre de chaque exercice' },
};

/** Chaque tâche renvoie { system, prompt, maxTokens, json }. `premium: true` = réservé aux abonnés. */
export const TASKS = {
  ping: () => ({ system: 'Réponds en une phrase courte.', prompt: 'Dis bonjour à un étudiant qui commence à utiliser StudyFlow.', maxTokens: 80 }),

  analyze: ({ text, subject, lang }) => ({
    json: true,
    maxTokens: 10000,
    system: `${TUTOR}\nTu analyses un support de cours et tu produis UNIQUEMENT un objet JSON valide, sans texte autour. ${langInstruction(lang)}`,
    prompt: `Matière : ${short(subject, 100)}
Analyse ce cours et renvoie ce JSON :
{
 "summary": "RÉSUMÉ DÉTAILLÉ en Markdown (500 à 1000 mots) : une section ### par grande partie du cours, dans l'ordre du cours ; pour chaque partie, les idées essentielles expliquées clairement, les mots importants en **gras**, des listes à puces et un court exemple quand c'est utile. Ne recopie pas le cours : reformule pour qu'un étudiant puisse réviser uniquement avec ce résumé.",
 "keyPoints": ["notions à retenir absolument"],
 "formulas": [{"formula": "formule", "meaning": "ce qu'elle signifie / variables"}],
 "codes": [{"code": "extrait de code important", "language": "python|sql|...", "explanation": "explication ligne par ligne, courte"}],
 "definitions": [{"term": "terme", "definition": "définition"}],
 "questions": ["questions probables à l'examen"],
 "sheet": "fiche de révision très courte en Markdown (10 lignes max)"
}
Laisse un tableau vide s'il n'y a rien (par ex. pas de code dans un cours de maths).

COURS :
${clip(text)}`,
  }),

  split: ({ text, lang }) => ({
    json: true,
    maxTokens: 6000,
    system: `Tu découpes une série d'exercices. Tu réponds UNIQUEMENT avec du JSON valide. ${langInstruction(lang)}`,
    prompt: `Repère chaque exercice de cette série et recopie son énoncé complet (sans le résoudre).
Format : {"exercises": [{"title": "Exercice 1 — sujet court", "statement": "énoncé complet"}]}

SÉRIE :
${clip(text)}`,
  }),

  correct: ({ statement, answer, subject, lang }) => ({
    maxTokens: 2500,
    system: `${TUTOR}
Tu corriges la réponse d'un étudiant SANS donner la solution complète.
- Commence par une ligne : "✅ Correct", "🟡 Presque" ou "❌ Erreur détectée".
- Dis ce qui est juste, puis explique précisément chaque erreur et POURQUOI c'est faux.
- Termine par une piste pour corriger (une question qui le fait réfléchir), jamais la réponse finale.
${langInstruction(lang)}`,
    prompt: `Matière : ${short(subject, 100)}\n\nÉNONCÉ :\n${short(statement)}\n\nRÉPONSE DE L'ÉTUDIANT :\n${short(answer) || '(vide)'}`,
  }),

  hint: ({ statement, answer, hints = [], subject, lang }) => ({
    maxTokens: 600,
    system: `${TUTOR}
Donne UN SEUL indice (niveau ${Math.min(3, hints.length + 1)} sur 3 : 1 = piste générale, 2 = méthode, 3 = presque la réponse).
Ne donne jamais la solution complète. 3 phrases maximum. Ne répète pas les indices précédents. ${langInstruction(lang)}`,
    prompt: `Matière : ${short(subject, 100)}\nÉNONCÉ :\n${short(statement)}\n\nIndices déjà donnés :\n${short(hints.join('\n'), 3000) || 'aucun'}\n\nRéponse actuelle de l'étudiant :\n${short(answer) || '(rien encore)'}`,
  }),

  solution: ({ statement, subject, lang }) => ({
    maxTokens: 3000,
    system: `${TUTOR}\nDonne la solution complète et commentée, étape par étape, puis les pièges fréquents. ${langInstruction(lang)}`,
    prompt: `Matière : ${short(subject, 100)}\nÉNONCÉ :\n${short(statement)}`,
  }),

  explain: ({ passage, mode, subject, lang }) => ({
    maxTokens: 2500,
    system: `${TUTOR}\n${langInstruction(lang)}`,
    prompt: `Matière : ${short(subject, 100)}\n${(EXPLAIN_MODES[mode] || EXPLAIN_MODES.simple).p}\n\nPASSAGE :\n${short(passage, 15000)}`,
  }),

  generate: ({ text, subject, type = 'td', count = 4, level = 'moyen', lang }) => {
    const t = GEN_TYPES[type] ? type : 'td';
    const n = Math.min(8, Math.max(1, Number(count) || 4));
    const lv = ['facile', 'moyen', 'difficile'].includes(level) ? level : 'moyen';
    return {
      json: true,
      premium: true,
      maxTokens: 12000,
      system: `${TUTOR}\nTu es aussi enseignant : tu crées des sujets de qualité, fidèles au cours fourni. Tu réponds UNIQUEMENT avec du JSON valide. ${langInstruction(lang)}`,
      prompt: `Matière : ${short(subject, 100)}
Crée ${GEN_TYPES[t].p}. Nombre d'exercices : ${n}. Niveau : ${lv}.
Chaque énoncé doit être complet et autonome. Chaque correction doit être détaillée, étape par étape, en Markdown (code dans des blocs \`\`\`).
Format : {"title": "titre du ${t.toUpperCase()}", "exercises": [{"title": "Exercice 1 — sujet court", "statement": "énoncé complet", "solution": "correction détaillée"}]}

COURS :
${clip(text)}`,
    };
  },
};

export function parseJSON(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error("Réponse de l'IA illisible, réessaie.");
  return JSON.parse(text.slice(start, end + 1));
}

// ----- Fin des prompts -----

const TRIAL_DAYS = 7;
const QUOTA_FREE = Number(Deno.env.get('QUOTA_FREE') || 10);
const QUOTA_PREMIUM = Number(Deno.env.get('QUOTA_PREMIUM') || 80);
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } = {} } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Connecte-toi pour utiliser l'IA." }, 401);

    const { task, params } = await req.json();
    const build = TASKS[task];
    if (!build) return json({ error: 'Tâche inconnue' }, 400);
    const spec = build(params || {});

    const { data: p } = await admin.from('profiles').select('trial_start, premium_until').eq('id', user.id).single();
    const now = Date.now();
    const premium = (p?.premium_until && Date.parse(p.premium_until) > now) || (p?.trial_start && Date.parse(p.trial_start) + TRIAL_DAYS * 86400000 > now);
    if (spec.premium && !premium) return json({ error: 'Cette fonction est réservée aux abonnés Premium. Démarre ton essai gratuit ou abonne-toi.' }, 402);

    const limit = premium ? QUOTA_PREMIUM : QUOTA_FREE;
    const { data: used, error: qErr } = await admin.rpc('bump_usage', { p_user: user.id, p_limit: limit });
    if (qErr) throw qErr;
    if (used === -1) {
      return json({ error: premium ? `Limite de ${limit} demandes IA par jour atteinte. Reviens demain !` : `Limite gratuite de ${limit} demandes IA par jour atteinte. Passe à Premium pour en avoir plus.` }, 429);
    }

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: "Le serveur IA n'est pas configuré (clé manquante)." }, 500);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: spec.maxTokens || 2500, system: spec.system, messages: [{ role: 'user', content: spec.prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic', res.status, data);
      return json({ error: "L'IA est momentanément indisponible, réessaie dans un instant." }, 502);
    }
    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return json({ text, usage: { used, limit } });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur du serveur : ' + (e?.message || e) }, 500);
  }
});
