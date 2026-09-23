import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artefacts and the audit snippet (a bare function expression
    // that Playwright MCP evaluates, not a module).
    ".playwright-mcp/**",
    "scripts/ui-audit.js", "scripts/ux-audit.js",
  ]),
]);

export default eslintConfig;
