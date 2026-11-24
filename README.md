# 🎓 StudyFlow

**Ton assistant d'étude intelligent** : résumés de cours détaillés, TP/TD corrigés, emploi du temps, échéances et rappels avant chaque cours.

StudyFlow est un site 100 % statique (HTML, CSS, JavaScript) : il s'héberge gratuitement sur **GitHub Pages**, sans serveur ni base de données. Les données de chaque étudiant restent dans son propre navigateur.

## ✨ Fonctionnalités (V1)

| | |
|---|---|
| 🏠 **Tableau de bord** | Programme du jour, prochains cours, devoirs et examens, progression par matière, série de jours 🔥 |
| 📚 **Matières** | Une fiche par matière avec ses cours, ses séries et ses échéances |
| 📄 **Analyse de PDF** | Résumé détaillé par parties, notions à retenir, définitions, formules, codes à connaître, questions d'examen et fiche de révision |
| 🃏 **Fiches mémo** | Cartes question/réponse générées à partir des définitions et formules |
| 👑 **TP / TD corrigés (Premium)** | TD d'exercices, TP pratiques et examens blancs générés depuis le cours, avec corrections détaillées. Essai gratuit de 7 jours |
| ⏰ **Échéances** | Devoirs, TP, TD, projets et examens avec compte à rebours (J-3, 5h…), filtres à venir / en retard / terminés |
| ⏱️ **Concentration** | Minuteur 25/45/60 min, minutes comptées dans la journée |
| 🧑‍🏫 **Explique-moi** | Sélectionne un passage : explication simple, niveau universitaire, exemple, exercice, quiz… en français, arabe ou anglais |
| 📝 **Séries d'exercices** | Détection automatique des exercices d'un PDF, réponse de l'étudiant, correction qui explique l'erreur, 3 indices progressifs, solution seulement sur demande |
| 📅 **Emploi du temps** | Semaine type, import rapide (« Lundi 08:00-10:00 Python, Amphi A »), devoirs et examens |
| 🔔 **Rappels intelligents** | « Ton cours de Python commence dans 45 min. Révise le Chapitre 3. Tu as 2 exercices non terminés. » + rappels 3 j / 1 j / 3 h avant un examen |
| 💾 **Sauvegarde** | Export / import JSON pour changer d'appareil |

### Avec ou sans IA

- **Sans clé** : l'analyse locale repère automatiquement les formules, les blocs de code, les définitions et les mots-clés, et produit un résumé extractif.
- **Avec une clé API Claude** (Paramètres → Intelligence artificielle) : résumé expliqué, explication des codes, vraies questions d'examen, correction des exercices, indices et mode « Explique-moi ». La clé est enregistrée uniquement dans le navigateur de l'étudiant et envoyée seulement à `api.anthropic.com`.

## 👑 Comptes et offre Premium

StudyFlow fonctionne en deux modes :

- **Mode simple** (par défaut, sans serveur) : pas de compte, chaque étudiant colle sa propre clé IA dans Paramètres. L'essai Premium est gardé dans le navigateur (contournable) : c'est une démo de l'offre.
- **Mode comptes** (avec Supabase) : inscription par e-mail, IA incluse avec **ta** clé cachée sur le serveur, essai de 7 jours et abonnement **vérifiés par le serveur**, quotas IA par jour, paiement Bankily / Masrvi / Sedad validé depuis une page **Administration**.

👉 Pour activer le mode comptes, suis le guide **[SUPABASE.md](SUPABASE.md)** (environ 20 minutes, rien à installer).

Prix, formules, numéros de paiement et contact : `js/config.js`.

## 🚀 Mettre le site en ligne (GitHub Pages)

1. Crée un dépôt sur GitHub (par ex. `studyflow`) et envoie-y le contenu de ce dossier.
2. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`.
3. Après une minute, le site est disponible sur `https://<ton-pseudo>.github.io/studyflow/`.

Ça marche aussi tel quel sur Vercel, Netlify ou Cloudflare Pages (aucune commande de build).

## 💻 Lancer en local

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

(Il faut passer par un petit serveur : ouvrir `index.html` directement ne charge pas les modules JavaScript.)

## 🗂️ Structure

```
index.html          page unique
css/style.css       design (clair/sombre, mobile)
js/app.js           pages et navigation
js/icons.js         icônes SVG
js/plan.js          essai gratuit / Premium
js/config.js        Supabase, prix, formules, paiement
js/cloud.js         comptes et abonnement (API Supabase)
js/prompts.js       prompts de l'IA (partagés avec le serveur)
supabase/schema.sql tables, sécurité et fonctions SQL
supabase/functions/ai/index.ts  serveur IA (généré depuis js/prompts.js)
tools/              génération du serveur IA
js/store.js         données (localStorage)
js/analyze.js       lecture des PDF + analyse locale
js/ai.js            appels à l'IA
js/reminders.js     rappels et notifications
js/demo.js          données d'exemple
vendor/             pdf.js (Mozilla, Apache 2.0)
```

## ⚠️ Limites connues

- Les notifications arrivent tant qu'un onglet StudyFlow est ouvert (même en arrière-plan). Des notifications avec le site fermé demanderaient des notifications push (à venir).
- Les PDF scannés (images) ne contiennent pas de texte : il faut un PDF texte ou coller le contenu.
- Les cours, exercices et l’emploi du temps restent dans le navigateur (même en mode comptes) : utilise l’export pour changer d’appareil.

## 🛣️ Idées pour la suite

Synchronisation des cours entre appareils, paiement en ligne automatique, mode examen avec QCM chronométré, détection des points faibles, gamification (XP, niveaux), application mobile (PWA), import d'emploi du temps depuis une photo.
