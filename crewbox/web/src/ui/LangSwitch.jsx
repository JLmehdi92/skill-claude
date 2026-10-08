import { getLang, setLang } from '../lib/i18n.js';
import { api } from '../lib/api.js';

/** FR / EN pill. The coworkers follow the same language with the owner. */
export default function LangSwitch() {
  const cur = getLang();
  const pick = (l) => {
    if (l === cur) return;
    setLang(l);
    api('set_language', { language: l }).catch(() => {});
    window.dispatchEvent(new CustomEvent('crewbox:lang', { detail: l }));
  };
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {['fr', 'en'].map((l) => <button key={l} className={cur === l ? 'on' : ''} onClick={() => pick(l)} aria-pressed={cur === l}>{l.toUpperCase()}</button>)}
    </div>
  );
}
