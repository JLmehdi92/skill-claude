import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import './styles/global.css';
import App from './App.jsx';
import { getLang } from './lib/i18n.js';

// A language switch remounts the app so every string is re-rendered in the new language.
function Root() {
  const [lang, setLangKey] = useState(getLang());
  useEffect(() => {
    const on = (e) => setLangKey(e.detail);
    window.addEventListener('crewbox:lang', on);
    return () => window.removeEventListener('crewbox:lang', on);
  }, []);
  return <App key={lang} />;
}

createRoot(document.getElementById('root')).render(<Root />);
