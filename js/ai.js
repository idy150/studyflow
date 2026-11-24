// Appels à l'IA (API Claude d'Anthropic) directement depuis le navigateur,
// avec la clé API que l'étudiant saisit dans Paramètres. La clé reste dans son navigateur.
import { get } from './store.js';

export const hasAI = () => !!get().settings.apiKey;

const LANG = { fr: 'en français', ar: 'en arabe (langue simple)', en: 'in English' };
export const langInstruction = (lang) => `Réponds ${LANG[lang] || LANG.fr}.`;

export async function ask({ system, prompt, maxTokens = 2500 }) {
  const { apiKey, model } = get().settings;
  if (!apiKey) throw new Error("Aucune clé API : ajoute-la dans Paramètres pour activer l'IA.");
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
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

export async function askJSON(opts) {
  const text = await ask(opts);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error("Réponse de l'IA illisible, réessaie.");
  return JSON.parse(text.slice(start, end + 1));
}

const TUTOR = `Tu es StudyFlow, un tuteur bienveillant pour étudiants universitaires.
Tu expliques clairement, avec des exemples concrets. Tu utilises du Markdown simple (titres ###, listes, **gras**, blocs de code \`\`\`).`;

const MAX = 60000;
const clip = (t) => (t.length > MAX ? t.slice(0, MAX) + '\n[... texte tronqué ...]' : t);

export function analyzeCourse(text, subject, lang) {
  return askJSON({
    maxTokens: 10000,
    system: `${TUTOR}\nTu analyses un support de cours et tu produis UNIQUEMENT un objet JSON valide, sans texte autour. ${langInstruction(lang)}`,
    prompt: `Matière : ${subject}
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
  });
}

export function splitExercises(text, lang) {
  return askJSON({
    maxTokens: 6000,
    system: `Tu découpes une série d'exercices. Tu réponds UNIQUEMENT avec du JSON valide. ${langInstruction(lang)}`,
    prompt: `Repère chaque exercice de cette série et recopie son énoncé complet (sans le résoudre).
Format : {"exercises": [{"title": "Exercice 1 — sujet court", "statement": "énoncé complet"}]}

SÉRIE :
${clip(text)}`,
  });
}

export function correct(ex, subject, lang) {
  return ask({
    system: `${TUTOR}
Tu corriges la réponse d'un étudiant SANS donner la solution complète.
- Commence par une ligne : "✅ Correct", "🟡 Presque" ou "❌ Erreur détectée".
- Dis ce qui est juste, puis explique précisément chaque erreur et POURQUOI c'est faux.
- Termine par une piste pour corriger (une question qui le fait réfléchir), jamais la réponse finale.
${langInstruction(lang)}`,
    prompt: `Matière : ${subject}\n\nÉNONCÉ :\n${ex.statement}\n\nRÉPONSE DE L'ÉTUDIANT :\n${ex.answer || '(vide)'}`,
  });
}

export function hint(ex, subject, lang) {
  const level = (ex.hints?.length || 0) + 1;
  return ask({
    maxTokens: 600,
    system: `${TUTOR}
Donne UN SEUL indice (niveau ${level} sur 3 : 1 = piste générale, 2 = méthode, 3 = presque la réponse).
Ne donne jamais la solution complète. 3 phrases maximum. Ne répète pas les indices précédents. ${langInstruction(lang)}`,
    prompt: `Matière : ${subject}\nÉNONCÉ :\n${ex.statement}\n\nIndices déjà donnés :\n${(ex.hints || []).join('\n') || 'aucun'}\n\nRéponse actuelle de l'étudiant :\n${ex.answer || '(rien encore)'}`,
  });
}

export function solution(ex, subject, lang) {
  return ask({
    system: `${TUTOR}\nDonne la solution complète et commentée, étape par étape, puis les pièges fréquents. ${langInstruction(lang)}`,
    prompt: `Matière : ${subject}\nÉNONCÉ :\n${ex.statement}`,
  });
}

export const EXPLAIN_MODES = {
  simple: { label: '👶 Explique simplement', p: "Explique ce passage très simplement, comme à un débutant, avec une analogie de la vie courante." },
  univ: { label: '🎓 Niveau universitaire', p: 'Explique ce passage de façon rigoureuse, niveau universitaire, avec le vocabulaire précis.' },
  example: { label: '💻 Donne un exemple', p: 'Donne un ou deux exemples concrets (code ou calcul si pertinent) qui illustrent ce passage.' },
  exercise: { label: '🧩 Donne un exercice', p: "Propose un exercice d'entraînement sur ce passage, avec la solution cachée à la fin sous un titre « Solution »." },
  quiz: { label: '❓ Pose-moi des questions', p: 'Pose 5 questions (QCM ou courtes) pour vérifier que j\'ai compris ce passage. Mets les réponses à la fin sous un titre « Réponses ».' },
  other: { label: '🔄 Explique autrement', p: "Explique ce passage d'une manière différente : schéma en texte, étapes numérotées ou comparaison." },
};

export function explain(passage, mode, subject, lang) {
  return ask({
    system: `${TUTOR}\n${langInstruction(lang)}`,
    prompt: `Matière : ${subject}\n${EXPLAIN_MODES[mode].p}\n\nPASSAGE :\n${clip(passage)}`,
  });
}

export const GEN_TYPES = {
  td: { label: 'TD (exercices)', p: "un TD : exercices d'application progressifs (du plus simple au plus difficile) qui couvrent les notions clés du cours" },
  tp: { label: 'TP (pratique)', p: "un TP : travail pratique guidé, en étapes concrètes (code, manipulation ou calcul selon la matière), avec un objectif clair et un résultat attendu" },
  exam: { label: 'Examen blanc', p: "un examen blanc réaliste : questions de cours, exercices et un problème de synthèse, avec un barème sur 20 dans le titre de chaque exercice" },
};

export function generateSet(text, subject, { type = 'td', count = 4, level = 'moyen' }, lang) {
  return askJSON({
    maxTokens: 12000,
    system: `${TUTOR}\nTu es aussi enseignant : tu crées des sujets de qualité, fidèles au cours fourni. Tu réponds UNIQUEMENT avec du JSON valide. ${langInstruction(lang)}`,
    prompt: `Matière : ${subject}
Crée ${GEN_TYPES[type].p}. Nombre d'exercices : ${count}. Niveau : ${level}.
Chaque énoncé doit être complet et autonome. Chaque correction doit être détaillée, étape par étape, en Markdown (code dans des blocs \`\`\`).
Format : {"title": "titre du ${type.toUpperCase()}", "exercises": [{"title": "Exercice 1 — sujet court", "statement": "énoncé complet", "solution": "correction détaillée"}]}

COURS :
${clip(text)}`,
  });
}
