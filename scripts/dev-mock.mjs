// Cross-platform `KIE_MOCK=1 next dev` (that inline env syntax does not work in Windows cmd).
import { spawn } from "node:child_process";

const child = spawn("npx next dev", { stdio: "inherit", shell: true, env: { ...process.env, KIE_MOCK: "1" } });
child.on("exit", (code) => process.exit(code ?? 0));
