// Offre Premium : essai gratuit puis abonnement.
// Avec Supabase configuré, l'état vient du serveur (et c'est le serveur qui vérifie l'accès).
// Sans Supabase, l'état est gardé dans le navigateur (mode démo, contournable).
import { get, update } from './store.js';
import { CONFIG, cloudEnabled } from './config.js';
import * as Cloud from './cloud.js';

const DAY = 86400000;

function source() {
  if (cloudEnabled()) {
    const p = Cloud.getProfile();
    if (!Cloud.user() || !p) return null;
    return { trialStart: p.trial_start ? Date.parse(p.trial_start) : null, premiumUntil: p.premium_until ? Date.parse(p.premium_until) : null };
  }
  return get().plan || {};
}

export function status(now = Date.now()) {
  const p = source();
  if (!p) return { kind: 'guest' };
  if (p.premiumUntil && p.premiumUntil > now) return { kind: 'premium', until: p.premiumUntil, daysLeft: Math.ceil((p.premiumUntil - now) / DAY) };
  const end = p.trialStart ? p.trialStart + CONFIG.trialDays * DAY : null;
  if (end && end > now) return { kind: 'trial', until: end, daysLeft: Math.ceil((end - now) / DAY) };
  if (end) return { kind: 'expired' };
  return { kind: 'free' };
}

export const isPremium = () => ['premium', 'trial'].includes(status().kind);

export async function startTrial() {
  if (cloudEnabled()) return Cloud.startTrial();
  update((s) => {
    s.plan = s.plan || {};
    if (!s.plan.trialStart) s.plan.trialStart = Date.now();
  });
}

export function contactLink() {
  if (!CONFIG.whatsapp) return '';
  return `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent("Bonjour, je souhaite m'abonner à StudyFlow Premium.")}`;
}
