// Runs before dev/build/start: fail with a clear message if this Node.js has no built-in SQLite.
const emit = process.emitWarning;
process.emitWarning = () => {}; // silence the one-time "SQLite is experimental" notice
const sqlite = process.getBuiltinModule?.("node:sqlite");
process.emitWarning = emit;

if (!sqlite) {
  console.error(
    `\n  Node.js ${process.versions.node} est trop ancien pour Higgsfield local (SQLite intégré manquant).` +
      "\n  Installe Node.js 24 LTS depuis https://nodejs.org (ou au minimum 22.13), ferme et rouvre le terminal, puis relance npm install.\n",
  );
  process.exit(1);
}
