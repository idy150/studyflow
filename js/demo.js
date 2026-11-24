// Données d'exemple pour découvrir StudyFlow en un clic.
import { localAnalysis } from './analyze.js';

const COURS_PYTHON = `Chapitre 3 — Les fonctions en Python

Une fonction est un bloc de code réutilisable qui effectue une tâche précise.
On définit une fonction avec le mot-clé def, suivi de son nom et de ses paramètres.

def addition(a, b):
    return a + b

Paramètre : variable déclarée dans la définition de la fonction.
Argument : valeur transmise à la fonction lors de l'appel.
L'instruction return renvoie une valeur à l'appelant et termine la fonction.
La différence entre return et print est importante : print affiche une valeur à l'écran, alors que return la renvoie pour qu'elle soit réutilisée.

Fonctions lambda
Une fonction lambda est une fonction anonyme écrite sur une seule ligne.

carre = lambda x: x ** 2
print(carre(4))

Portée des variables
Une variable locale est une variable définie à l'intérieur d'une fonction ; elle n'existe que pendant l'exécution de la fonction.
Une variable globale est définie en dehors de toute fonction.

Complexité : le nombre d'appels d'une fonction récursive naïve de Fibonacci vérifie T(n) = T(n-1) + T(n-2) + 1.`;

const SERIE_PYTHON = `Série 3 — Fonctions

Exercice 1
Écrire une fonction moyenne(a, b, c) qui renvoie la moyenne de trois nombres.

Exercice 2
Écrire une fonction est_pair(n) qui renvoie True si n est pair et False sinon.

Exercice 3
Écrire une fonction maximum(liste) qui renvoie le plus grand élément d'une liste sans utiliser la fonction max.`;

export function loadDemo(store) {
  const { uid } = store;
  const py = { id: uid(), name: 'Python', icon: 'code', color: '#6c4cf5' };
  const bd = { id: uid(), name: 'Bases de données', icon: 'database', color: '#3aa6e0' };
  const ma = { id: uid(), name: 'Mathématiques', icon: 'sigma', color: '#d98a1c' };
  const now = new Date();
  const inMin = (m) => {
    const d = new Date(now.getTime() + m * 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const isoIn = (days, h = 9) => {
    const d = new Date(now.getTime() + days * 86400000);
    d.setHours(h, 0, 0, 0);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const today = now.getDay();
  const coursId = uid();
  const serieId = uid();
  store.update((s) => {
    s.subjects.push(py, bd, ma);
    // Un cours de Python qui commence dans 45 min (pour voir les rappels tout de suite)
    if (now.getHours() < 21) s.events.push({ id: uid(), subjectId: py.id, day: today, start: inMin(45), end: inMin(165), room: 'Amphi A' });
    s.events.push(
      { id: uid(), subjectId: bd.id, day: (today + 1) % 7, start: '10:00', end: '12:00', room: 'Salle 12' },
      { id: uid(), subjectId: ma.id, day: (today + 2) % 7, start: '14:00', end: '16:00', room: 'Amphi B' },
      { id: uid(), subjectId: py.id, day: (today + 3) % 7, start: '08:00', end: '10:00', room: 'Labo 3' },
    );
    s.deadlines.push(
      { id: uid(), subjectId: bd.id, title: 'Devoir : requêtes JOIN', type: 'devoir', due: isoIn(2, 18), done: false },
      { id: uid(), subjectId: ma.id, title: 'Examen de Mathématiques', type: 'examen', due: isoIn(5, 9), done: false },
      { id: uid(), subjectId: py.id, title: 'Rendre le TP 3 : fonctions et listes', type: 'tp', due: isoIn(1, 23), done: false },
      { id: uid(), subjectId: ma.id, title: 'TD 4 : suites numériques', type: 'td', due: isoIn(9, 8), done: false },
    );
    s.docs.push(
      { id: coursId, subjectId: py.id, kind: 'cours', name: 'Chapitre 3 — Les fonctions', text: COURS_PYTHON, createdAt: Date.now(), analysis: localAnalysis(COURS_PYTHON), analysisMode: 'local' },
      { id: serieId, subjectId: py.id, kind: 'serie', name: 'Série 3 — Fonctions', text: SERIE_PYTHON, createdAt: Date.now() },
    );
    const exs = SERIE_PYTHON.split(/\n(?=Exercice)/).slice(1);
    exs.forEach((t, i) =>
      s.exercises.push({ id: uid(), docId: serieId, subjectId: py.id, num: i + 1, title: `Exercice ${i + 1}`, statement: t.trim(), status: i === 0 ? 'done' : 'todo', answer: i === 0 ? 'def moyenne(a, b, c):\n    return (a + b + c) / 3' : '', hints: [], feedback: '', solution: '' }),
    );
    if (!s.profile.name) s.profile.name = 'Étudiant';
    store.logActivity();
  });
}
