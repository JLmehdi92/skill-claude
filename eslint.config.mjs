import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", "storage/**", "storage-e2e/**", "node_modules/**", "playwright-report/**", "test-results/**", ".claude/**"] },
];

export default config;
