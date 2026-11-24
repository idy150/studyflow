// Connexion à Supabase (comptes, abonnement, IA côté serveur) via son API HTTP, sans dépendance.
import { CONFIG, cloudEnabled } from './config.js';

const SKEY = 'sf:session';
const PKEY = 'sf:profile';
let session = JSON.parse(localStorage.getItem(SKEY) || 'null');
let profile = JSON.parse(localStorage.getItem(PKEY) || 'null');

export const enabled = cloudEnabled;
export const user = () => session?.user || null;
export const getProfile = () => profile;
let usage = null;
export const getUsage = () => usage;
const base = () => CONFIG.supabaseUrl.replace(/\/$/, '');

function saveSession(s) {
  session = s ? { ...s, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) } : null;
  if (session) localStorage.setItem(SKEY, JSON.stringify(session));
  else localStorage.removeItem(SKEY);
}

function setProfile(p) {
  profile = p;
  if (p) localStorage.setItem(PKEY, JSON.stringify(p));
  else localStorage.removeItem(PKEY);
}

async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { apikey: CONFIG.supabaseAnonKey, 'content-type': 'application/json', ...headers };
  if (auth) {
    const t = await token();
    if (!t) throw new Error('Connecte-toi pour continuer.');
    h.authorization = `Bearer ${t}`;
  }
  const res = await fetch(base() + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || data?.error || `Erreur ${res.status}`;
    const err = new Error(translate(String(msg)));
    err.status = res.status;
    throw err;
  }
  return data;
}

function translate(msg) {
  const t = {
    'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
    'Email not confirmed': "Confirme d'abord ton e-mail (regarde ta boîte de réception).",
    'User already registered': 'Un compte existe déjà avec cet e-mail. Connecte-toi.',
  };
  for (const [k, v] of Object.entries(t)) if (msg.includes(k)) return v;
  if (/Password should be at least/i.test(msg)) return 'Le mot de passe doit contenir au moins 6 caractères.';
  return msg;
}

/** Jeton d'accès valide (rafraîchi si besoin). */
export async function token() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  try {
    const s = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: session.refresh_token } });
    saveSession(s);
    return s.access_token;
  } catch {
    saveSession(null);
    setProfile(null);
    return null;
  }
}

export async function signUp(email, password, name) {
  const redirect = location.origin + location.pathname;
  const r = await call(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', auth: false, body: { email, password, data: { name } } });
  if (r?.access_token) {
    saveSession(r);
    await refreshProfile();
    return { confirmed: true };
  }
  return { confirmed: false };
}

export async function signIn(email, password) {
  const s = await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
  saveSession(s);
  await refreshProfile();
}

export async function signOut() {
  try {
    await call('/auth/v1/logout', { method: 'POST' });
  } catch {}
  saveSession(null);
  setProfile(null);
}

export async function recover(email) {
  const redirect = location.origin + location.pathname;
  await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', auth: false, body: { email } });
}

export async function updatePassword(password) {
  await call('/auth/v1/user', { method: 'PUT', body: { password } });
}

/** Lien reçu par e-mail (confirmation, mot de passe oublié) : les jetons arrivent dans l'URL. */
export async function handleRedirect() {
  const h = location.hash;
  if (!h.includes('access_token=') && !h.includes('error_description=')) return null;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  history.replaceState(null, '', location.pathname + '#/');
  if (p.get('error_description')) return { error: p.get('error_description') };
  saveSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600, user: null });
  const u = await call('/auth/v1/user');
  saveSession({ ...session, user: u });
  await refreshProfile();
  return { type: p.get('type') };
}

export async function refreshProfile() {
  if (!session) return setProfile(null);
  const rows = await call(`/rest/v1/profiles?id=eq.${session.user.id}&select=*`);
  setProfile(rows?.[0] || null);
  return profile;
}

export async function updateName(name) {
  await call(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: 'PATCH', body: { name } });
  await refreshProfile();
}

export const rpc = (fn, args = {}) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });

export async function startTrial() {
  await rpc('start_trial');
  return refreshProfile();
}

/** Appelle le serveur IA (Supabase Edge Function « ai »). */
export async function runTask(task, params) {
  const r = await call('/functions/v1/ai', { method: 'POST', body: { task, params } });
  if (r?.usage) usage = r.usage;
  return r.text;
}

export const submitPayment = (p) =>
  call('/rest/v1/payments', { method: 'POST', body: { ...p, user_id: session.user.id }, headers: { prefer: 'return=minimal' } });

export const myPayments = () => call(`/rest/v1/payments?user_id=eq.${session.user.id}&select=*&order=created_at.desc&limit=10`);

export const adminPayments = (status = 'pending') =>
  call(`/rest/v1/payments?status=eq.${status}&select=*,profiles(email,name,premium_until)&order=created_at.desc&limit=100`);

export const approvePayment = (id, days) => rpc('approve_payment', { p_id: id, p_days: days });
export const rejectPayment = (id) => rpc('reject_payment', { p_id: id });
export const adminStats = () => rpc('admin_stats');
