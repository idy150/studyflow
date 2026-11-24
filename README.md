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

## 👑 Offre Premium

Les réglages (durée d'essai, prix, contact WhatsApp ou e-mail pour s'abonner) sont dans `js/config.js`.

⚠️ Tant qu'il n'y a pas de serveur, l'essai et l'accès Premium sont gérés dans le navigateur de l'étudiant : c'est une vitrine de l'offre, pas un verrou sécurisé. Le vrai contrôle (comptes, paiement vérifié, clé IA côté serveur) est l'étape suivante.

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
js/config.js        prix, durée d'essai, contact
js/store.js         données (localStorage)
js/analyze.js       lecture des PDF + analyse locale
js/ai.js            appels à l'IA
js/reminders.js     rappels et notifications
js/demo.js          données d'exemple
vendor/             pdf.js (Mozilla, Apache 2.0)
```

## ⚠️ Limites connues de la V1

- Les notifications arrivent tant qu'un onglet StudyFlow est ouvert (même en arrière-plan). Des notifications avec le site fermé demanderaient un serveur (V2).
- Les PDF scannés (images) ne contiennent pas de texte : il faut un PDF texte ou coller le contenu.
- Les données sont propres à chaque navigateur : utilise l'export pour les transférer.

## 🛣️ Idées pour la V2

Comptes et synchronisation (Supabase), mode examen avec QCM chronométré, détection des points faibles, gamification (XP, niveaux), application mobile (PWA), import d'emploi du temps depuis une photo.
