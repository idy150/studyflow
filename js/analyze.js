// Lecture des PDF et analyse locale (sans IA) : fonctionne hors ligne et sans clé API.
// pdf.js (Mozilla, licence Apache 2.0) est inclus dans /vendor pour fonctionner sans CDN.
const PDFJS = new URL('../vendor/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export async function extractText(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    return await file.text(); // .txt, .md, .py, .sql...
  }
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstitue les lignes à partir de la position verticale des morceaux de texte.
    let lastY = null;
    let line = '';
    const lines = [];
    for (const item of content.items) {
      const y = Math.round(item.transform?.[5] ?? 0);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
        lastY = null;
        continue;
      }
      lastY = y;
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n'));
  }
  const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 30) {
    throw new Error("Ce PDF ne contient presque pas de texte (c'est peut-être un scan/une image). Essaie un PDF texte ou copie-colle le contenu.");
  }
  return text;
}

const STOP = new Set(`le la les un une des de du d l et ou en au aux a à ce ces cet cette il elle ils elles on nous vous je tu se sa son ses leur leurs que qui quoi dont où ne pas plus pour par sur dans avec sans est sont être été avoir ont fait faire comme mais donc car si tout tous toute toutes très peut peuvent entre lors alors ainsi aussi bien même autre autres chaque deux cas exemple exemples fig figure page chapitre partie the of and to in is are for on with this that be as by an it from or at which can will`.split(/\s+/));

const CODE_RE = /^\s*(def |class |import |from \S+ import|return\b|print\(|for .+:|while .+:|if .+:|elif |else:|try:|except|SELECT\b|FROM\b|WHERE\b|INSERT\b|UPDATE\b|DELETE\b|CREATE\b|JOIN\b|#include|int |void |public |private |function\b|\w+\s*=\s*lambda\b|const |let |var |console\.|System\.out|\}|\{$|.*;\s*$|<\/?[a-z]+[ >])/i;
const FORMULA_RE = /(=|≤|≥|≠|≈|∑|∫|√|π|∞|∀|∃|∈|⇒|⇔|→|\^|²|³|\bsin\b|\bcos\b|\blog\b|\blim\b|\bexp\b)/;
const DEF_RE = /^(.{2,60}?)\s*(?::|—|–|\best\s+(?:(?:une|un|le|la)(?=\s)|l['’])|\bse définit\b|\bdésigne\b|\bcorrespond à\b)\s*(.{10,})$/i;

function sentences(text) {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý0-9])/).map((s) => s.trim()).filter((s) => s.length > 30 && s.length < 400);
}

function words(s) {
  return (s.toLowerCase().normalize('NFC').match(/[a-zà-ÿ][a-zà-ÿ0-9_'’-]{2,}/g) || [])
    .map((w) => w.replace(/^(?:[dlnsjmtc]|qu)['’]/, ''))
    .filter((w) => w.length > 2);
}

export function localAnalysis(text) {
  const lines = text.split('\n').map((l) => l.trimEnd());

  // Code : blocs de lignes consécutives qui ressemblent à du code
  const codes = [];
  let block = [];
  const flush = () => {
    if (block.length >= 2 || (block.length === 1 && block[0].length > 12 && /[(){};=]/.test(block[0]))) {
      codes.push({ code: block.join('\n'), language: guessLang(block.join('\n')), explanation: '' });
    }
    block = [];
  };
  for (const l of lines) {
    if (l.trim() && CODE_RE.test(l) && l.length < 160) block.push(l);
    else if (block.length && /^\s{2,}\S/.test(l)) block.push(l);
    else flush();
  }
  flush();
  const codeLines = new Set(codes.flatMap((c) => c.code.split('\n')));

  // Formules
  const formulas = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t || codeLines.has(l) || t.length > 140) continue;
    const letters = (t.match(/[a-zà-ÿ]/gi) || []).length;
    if (!FORMULA_RE.test(t)) continue;
    if (letters / t.length < 0.6) formulas.push({ formula: t, meaning: '' });
    else {
      const eq = t.match(/[\wÀ-ÿ()²³+\-*/^ ]*[=≤≥≠≈⇒⇔][^.;:]*/);
      const f = eq?.[0].trim().replace(/^(?:[a-zà-ÿ]{2,}\s+)+/i, '');
      if (f && f.length > 4) formulas.push({ formula: f, meaning: t.length > eq[0].length + 5 ? t : '' });
    }
  }

  // Définitions
  const definitions = [];
  const seen = new Set();
  for (const l of lines) {
    const t = l.trim();
    if (codeLines.has(l) || t.length > 300) continue;
    const m = t.match(DEF_RE);
    if (m) {
      const term = m[1].replace(/^[-•*\d.)\s]+/, '').replace(/^(définition|def\.?)\s*:?\s*/i, '').replace(/^(une?|les?|la|l['’])\s*/i, '').trim();
      if (/^(chapitre|partie|section|exercice|série|serie|tp|td)\b/i.test(term)) continue;
      if (term.split(' ').length <= 6 && term.length > 1 && !seen.has(term.toLowerCase()) && !/[=(){};]/.test(term)) {
        seen.add(term.toLowerCase());
        definitions.push({ term, definition: m[2].trim() });
      }
    }
  }

  // Mots-clés par fréquence
  const freq = {};
  for (const w of words(text)) if (!STOP.has(w) && !/^\d/.test(w)) freq[w] = (freq[w] || 0) + 1;
  for (const w of Object.keys(freq)) if (w.endsWith('s') && freq[w.slice(0, -1)]) { freq[w.slice(0, -1)] += freq[w]; delete freq[w]; }
  const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);

  // Résumé : phrases les mieux notées selon la fréquence des mots
  const sents = sentences(lines.filter((l) => !codeLines.has(l)).join('\n'));
  const scored = sents.map((s, i) => {
    const ws = words(s).filter((w) => !STOP.has(w));
    const score = ws.reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(ws.length || 1);
    return { s, i, score };
  });
  const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 6).sort((a, b) => a.i - b.i);
  const summary = top.map((x) => x.s).join(' ');

  const questions = [
    ...definitions.slice(0, 5).map((d) => `Qu'est-ce que « ${d.term} » ?`),
    ...keywords.slice(0, 3).map((k) => `Explique le rôle de « ${k} » dans ce chapitre, avec un exemple.`),
  ];
  if (codes.length) questions.push('Explique ce que fait le code ci-dessus, ligne par ligne, et donne le résultat affiché.');
  if (formulas.length) questions.push('Applique la formule principale du cours sur un exemple numérique.');

  const sheet = [
    '### Fiche express',
    ...keywords.slice(0, 6).map((k) => `- **${k}**`),
    ...definitions.slice(0, 4).map((d) => `- ${d.term} : ${d.definition.slice(0, 90)}`),
  ].join('\n');

  return {
    summary: summary || text.slice(0, 600),
    keyPoints: keywords,
    formulas: formulas.slice(0, 25),
    codes: codes.slice(0, 15),
    definitions: definitions.slice(0, 20),
    questions,
    sheet,
  };
}

function guessLang(code) {
  if (/\bSELECT\b|\bFROM\b|\bCREATE TABLE\b/i.test(code)) return 'sql';
  if (/\bdef |print\(|import |elif /.test(code)) return 'python';
  if (/#include|printf|int main/.test(code)) return 'c';
  if (/System\.out|public class/.test(code)) return 'java';
  if (/function |const |console\./.test(code)) return 'javascript';
  return '';
}

export function localSplitExercises(text) {
  const re = /^\s*(exercice|exercise|ex\.?|problème|question)\s*n?°?\s*(\d+)\b.*$/gim;
  const marks = [...text.matchAll(re)];
  if (!marks.length) return [{ title: 'Exercice 1', statement: text.trim() }];
  return marks.map((m, i) => {
    const start = m.index;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const body = text.slice(start, end).trim();
    const first = body.split('\n')[0].trim();
    return { title: first.length < 80 ? first : `Exercice ${m[2]}`, statement: body };
  });
}
