# 🔐 Activer les comptes et l'abonnement payant (Supabase)

Ce guide branche StudyFlow sur **Supabase** (gratuit pour démarrer). Ensuite :

- les étudiants créent un compte (e-mail + mot de passe) ;
- l'IA passe par **ton** serveur, avec **ta** clé : les étudiants n'ont plus de clé à coller ;
- l'essai gratuit de 7 jours et l'abonnement Premium sont **vérifiés par le serveur** (impossible à contourner) ;
- chaque compte a un quota d'appels IA par jour (10 gratuit, 80 Premium) pour maîtriser tes coûts ;
- les étudiants paient par Bankily / Masrvi / Sedad et tu valides les paiements depuis la page **Administration**.

Compte environ 20 minutes. Tu n'as rien à installer sur ton ordinateur.

---

## 1. Créer le projet Supabase

1. Va sur <https://supabase.com>, crée un compte puis **New project**.
2. Nom : `studyflow`. Choisis un mot de passe de base de données (garde-le) et la région **Europe (Paris / Frankfurt)**, la plus proche de la Mauritanie.
3. Attends 1 à 2 minutes que le projet soit prêt.

## 2. Créer les tables

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Copie tout le contenu du fichier [`supabase/schema.sql`](supabase/schema.sql), colle-le, puis clique **Run**.
3. Tu dois voir « Success. No rows returned ».

## 3. Créer ta clé IA (Anthropic)

1. Va sur <https://console.anthropic.com>, crée un compte et ajoute un moyen de paiement (Billing). Commence avec un petit montant, par exemple 5 $.
2. **Settings → API Keys → Create Key**. Copie la clé (`sk-ant-…`). Ne la mets **jamais** dans le code du site.

> 💡 Pour réduire les coûts, tu peux utiliser le modèle `claude-haiku-5-5` (plus rapide et moins cher) au lieu de `claude-sonnet-5-5`. Voir l'étape 4.

## 4. Mettre le serveur IA en ligne (Edge Function)

1. Dans Supabase : **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nom de la fonction : **`ai`** (exactement).
3. Efface le code d'exemple, colle tout le contenu de [`supabase/functions/ai/index.ts`](supabase/functions/ai/index.ts), puis clique **Deploy function**.
4. Va dans **Edge Functions → Secrets** (ou **Project Settings → Edge Functions**) et ajoute :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | ta clé `sk-ant-…` |
| `ANTHROPIC_MODEL` | *(facultatif)* `claude-haiku-5-5` pour économiser, sinon `claude-sonnet-5-5` par défaut |
| `QUOTA_FREE` | *(facultatif)* appels IA par jour pour un compte gratuit, `10` par défaut |
| `QUOTA_PREMIUM` | *(facultatif)* appels IA par jour pour un abonné, `80` par défaut |

## 5. Régler la connexion par e-mail

1. **Authentication → URL Configuration** :
   - **Site URL** : `https://idy150.github.io/studyflow/`
   - **Redirect URLs** : ajoute `https://idy150.github.io/studyflow/**`
2. **Authentication → Sign In / Providers → Email** : laisse « Confirm email » activé (recommandé contre les faux comptes).

> ℹ️ Le service d'e-mail intégré de Supabase est limité à quelques e-mails par heure. Quand tu auras beaucoup d'inscriptions, branche un service SMTP (Brevo, Resend…) dans **Authentication → Emails → SMTP Settings**.

## 6. Relier le site à Supabase

1. Dans Supabase : **Project Settings → API**. Copie :
   - **Project URL** (ex. `https://abcdefgh.supabase.co`)
   - la clé **anon / publishable** (elle est faite pour être publique ; ne copie **pas** la clé `service_role` / secret).
2. Sur GitHub, ouvre [`js/config.js`](js/config.js) → bouton ✏️ (Edit) et remplis :

```js
supabaseUrl: 'https://abcdefgh.supabase.co',
supabaseAnonKey: 'eyJhbGciOi…',
```

3. Dans le même fichier, mets tes numéros de paiement :

```js
paymentMethods: [
  { id: 'bankily', label: 'Bankily', account: '22 00 00 00' },
  { id: 'masrvi', label: 'Masrvi', account: '' },   // vide = non affiché
  { id: 'sedad', label: 'Sedad', account: '' },
],
```

   et, si tu veux, tes prix dans `plans` et ton numéro WhatsApp dans `whatsapp`.
4. **Commit changes**. GitHub Pages met le site à jour en 1 à 2 minutes.

## 7. Devenir administrateur

1. Sur ton site, va dans **Mon compte → Créer un compte**, inscris-toi et confirme ton e-mail.
2. Dans Supabase → **SQL Editor**, lance (avec ton e-mail) :

```sql
update public.profiles set is_admin = true where email = 'ton.email@exemple.com';
```

3. Recharge le site : un bouton **Administration** apparaît dans **Mon compte**.

---

## Au quotidien : valider un abonnement

1. L'étudiant envoie l'argent sur ton Bankily/Masrvi, puis remplit le formulaire de la page **Premium** avec le numéro de transaction.
2. Tu reçois le SMS de paiement. Ouvre **Mon compte → Administration**, vérifie que le numéro de transaction et le montant correspondent, puis clique **Valider**.
3. L'abonnement est activé immédiatement (30, 90 ou 365 jours selon la formule, ajoutés à l'abonnement en cours s'il y en a un).

## Ce qui est protégé côté serveur

- Un étudiant ne peut **pas** modifier son essai, son abonnement ni se donner le rôle admin (seul son nom est modifiable).
- Il ne voit que **ses** paiements ; il ne peut pas valider un paiement lui-même.
- La génération de TP/TD est refusée par le serveur sans essai ou abonnement actif.
- Les prompts sont construits par le serveur : impossible de détourner l'IA pour autre chose que StudyFlow.
- Ta clé Anthropic reste dans les secrets Supabase, jamais envoyée au navigateur.

## Modifier les prompts de l'IA

Les prompts sont dans `js/prompts.js` (utilisé par le site **et** par le serveur). Après une modification, lance `node tools/build-function.mjs` pour régénérer `supabase/functions/ai/index.ts`, puis redéploie la fonction (étape 4).
