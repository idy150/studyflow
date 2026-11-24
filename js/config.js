// Réglages de StudyFlow : modifie ces valeurs pour ton lancement.
export const CONFIG = {
  // --- Supabase (comptes, abonnements, IA côté serveur) ---
  // Supabase → Project Settings → API. La clé « anon / publishable » est faite pour être publique.
  // Laisse vide pour utiliser le site sans comptes (chaque étudiant met alors sa propre clé IA).
  supabaseUrl: '',
  supabaseAnonKey: '',

  // --- Offre Premium ---
  trialDays: 7, // durée de l'essai gratuit (doit être identique à la valeur dans supabase/schema.sql)
  plans: [
    { id: 'mois', label: '1 mois', price: 300, days: 30 },
    { id: 'trimestre', label: '3 mois', price: 800, days: 90 },
    { id: 'annee', label: '1 an', price: 2500, days: 365 },
  ],
  currency: 'MRU',

  // Où l'étudiant envoie l'argent (affiché sur la page Premium).
  paymentMethods: [
    { id: 'bankily', label: 'Bankily', account: '' }, // ex. '22 00 00 00'
    { id: 'masrvi', label: 'Masrvi', account: '' },
    { id: 'sedad', label: 'Sedad', account: '' },
  ],
  // Contact (facultatif) : numéro WhatsApp avec indicatif, sans + (ex. '22200000000')
  whatsapp: '',

  // Nombre d'appels à l'IA par jour (doit être identique aux valeurs du serveur, supabase/functions/ai)
  quotaFree: 10,
  quotaPremium: 80,
};

export const cloudEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
