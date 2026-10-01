// Prints the addresses to open the app on this computer and on a phone on the same Wi-Fi.
import os from "node:os";

const port = process.env.PORT || 3000;
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

console.log("\n  Higgsfield local\n");
console.log(`  Sur ce PC :                      http://localhost:${port}`);
for (const ip of lan) console.log(`  Sur ton téléphone (même Wi-Fi) : http://${ip}:${port}`);
if (!lan.length) console.log("  Aucun réseau local détecté : connecte ce PC au Wi-Fi pour l'ouvrir sur ton téléphone.");
console.log("\n  Pas de mot de passe : à utiliser seulement sur un Wi-Fi de confiance.\n");
