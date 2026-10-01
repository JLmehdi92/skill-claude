import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.join(root, "tests/unit/server-only-stub.ts"),
    },
  },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", fileParallelism: false },
});
