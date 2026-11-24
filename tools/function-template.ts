// @ts-nocheck
// =====================================================================
// StudyFlow : serveur IA (Supabase Edge Function « ai »)
// FICHIER GÉNÉRÉ par tools/build-function.mjs à partir de js/prompts.js : ne pas modifier à la main.
//
// - Vérifie que l'étudiant est connecté.
// - Vérifie l'accès Premium (essai ou abonnement) pour la génération de TP/TD.
// - Applique un quota d'appels par jour.
// - Appelle Claude avec TA clé (secret ANTHROPIC_API_KEY), jamais visible par les étudiants.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

/*__PROMPTS__*/

const TRIAL_DAYS = 7;
const QUOTA_FREE = Number(Deno.env.get('QUOTA_FREE') || 10);
const QUOTA_PREMIUM = Number(Deno.env.get('QUOTA_PREMIUM') || 80);
const MODEL = Deno.env.get('ANTHROPIC_MODEL') || 'claude-sonnet-5-5';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } = {} } = await admin.auth.getUser(jwt);
    if (!user) return json({ error: "Connecte-toi pour utiliser l'IA." }, 401);

    const { task, params } = await req.json();
    const build = TASKS[task];
    if (!build) return json({ error: 'Tâche inconnue' }, 400);
    const spec = build(params || {});

    const { data: p } = await admin.from('profiles').select('trial_start, premium_until').eq('id', user.id).single();
    const now = Date.now();
    const premium = (p?.premium_until && Date.parse(p.premium_until) > now) || (p?.trial_start && Date.parse(p.trial_start) + TRIAL_DAYS * 86400000 > now);
    if (spec.premium && !premium) return json({ error: 'Cette fonction est réservée aux abonnés Premium. Démarre ton essai gratuit ou abonne-toi.' }, 402);

    const limit = premium ? QUOTA_PREMIUM : QUOTA_FREE;
    const { data: used, error: qErr } = await admin.rpc('bump_usage', { p_user: user.id, p_limit: limit });
    if (qErr) throw qErr;
    if (used === -1) {
      return json({ error: premium ? `Limite de ${limit} demandes IA par jour atteinte. Reviens demain !` : `Limite gratuite de ${limit} demandes IA par jour atteinte. Passe à Premium pour en avoir plus.` }, 429);
    }

    const key = Deno.env.get('ANTHROPIC_API_KEY');
    if (!key) return json({ error: "Le serveur IA n'est pas configuré (clé manquante)." }, 500);
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: spec.maxTokens || 2500, system: spec.system, messages: [{ role: 'user', content: spec.prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic', res.status, data);
      return json({ error: "L'IA est momentanément indisponible, réessaie dans un instant." }, 502);
    }
    const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return json({ text, usage: { used, limit } });
  } catch (e) {
    console.error(e);
    return json({ error: 'Erreur du serveur : ' + (e?.message || e) }, 500);
  }
});
