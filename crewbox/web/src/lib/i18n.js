import FR from './fr.js';

// Gettext-style: the English text is the key; French lives in fr.js. Missing entries fall back
// to English. The app remounts on a language switch, so a plain function is enough.
const KEY = 'crewbox.lang';
let lang = (() => { try { return localStorage.getItem(KEY) || 'fr'; } catch { return 'fr'; } })();

export const getLang = () => lang;
export function setLang(l) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
}
document.documentElement.lang = lang;

export function t(s, vars) {
  let out = lang === 'fr' ? FR[s] ?? s : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

/** Plural helper: t1('{n} coworker', '{n} coworkers', n). */
export const tn = (one, many, n) => t(n === 1 ? one : many, { n });

export const dateLocale = () => (lang === 'fr' ? 'fr-FR' : 'en-US');
