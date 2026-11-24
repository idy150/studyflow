// Offre Premium : essai gratuit puis abonnement.
// ⚠️ Sans serveur, ce contrôle vit dans le navigateur : il sert à présenter l'offre.
// Le vrai verrou (comptes + paiement vérifié) viendra avec le backend.
import { get, update } from './store.js';
import { CONFIG } from './config.js';

const DAY = 86400000;

export function plan() {
  return get().plan || {};
}

export function trialEndsAt() {
  const p = plan();
  return p.trialStart ? p.trialStart + CONFIG.trialDays * DAY : null;
}

export function status(now = Date.now()) {
  const p = plan();
  if (p.premiumUntil && p.premiumUntil > now) return { kind: 'premium', until: p.premiumUntil };
  const end = trialEndsAt();
  if (end && end > now) return { kind: 'trial', until: end, daysLeft: Math.ceil((end - now) / DAY) };
  if (end) return { kind: 'expired' };
  return { kind: 'free' };
}

export const isPremium = () => ['premium', 'trial'].includes(status().kind);

export function startTrial() {
  update((s) => {
    s.plan = s.plan || {};
    if (!s.plan.trialStart) s.plan.trialStart = Date.now();
  });
}

export function contactLink() {
  const msg = encodeURIComponent("Bonjour, je souhaite m'abonner à StudyFlow Premium.");
  if (CONFIG.whatsapp) return `https://wa.me/${CONFIG.whatsapp}?text=${msg}`;
  if (CONFIG.email) return `mailto:${CONFIG.email}?subject=${encodeURIComponent('Abonnement StudyFlow Premium')}&body=${msg}`;
  return '';
}
