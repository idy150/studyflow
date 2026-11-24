// Génère supabase/functions/ai/index.ts à partir de js/prompts.js et du modèle.
// Usage : node tools/build-function.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('..', import.meta.url);
const prompts = readFileSync(new URL('js/prompts.js', root), 'utf8');
const tpl = readFileSync(new URL('tools/function-template.ts', root), 'utf8');
writeFileSync(new URL('supabase/functions/ai/index.ts', root), tpl.replace('/*__PROMPTS__*/', `// ----- Prompts (copie de js/prompts.js) -----\n${prompts}\n// ----- Fin des prompts -----`));
console.log('supabase/functions/ai/index.ts généré');
