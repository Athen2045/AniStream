// @ts-check
import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

// typescript-eslint (parser and eslint-plugin alike) hard-refuses to run against
// TypeScript >= 7 as of this writing -- both packages throw at require-time rather
// than just warning, and the project deliberately runs TS 7 (see CONTEXT.md). This
// config therefore parses TS/TSX syntax with @babel/eslint-parser (which only needs
// to understand the grammar, not run the TS compiler) instead. Revisit once
// typescript-eslint ships TS 7 support:
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
//
// Consequence: babel erases type-only syntax (import type, parameter properties)
// before ESLint's scope analysis runs, so plain `no-unused-vars` misreports
// type-only imports and `private readonly x: T` constructor params as unused.
// `tsc --noEmit` has `noUnusedLocals`/`noUnusedParameters` enabled instead, which
// understands both correctly -- so `no-unused-vars` is disabled for .ts/.tsx and
// left on for plain .mjs scripts, where it has no such blind spot.
const babelOptions = {
  presets: ["@babel/preset-typescript", ["@babel/preset-react", { runtime: "automatic" }]],
};

export default [
  {
    ignores: ["dist/**", "out/**", "node_modules/**", "**/*.tsbuildinfo"],
  },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // TS syntax itself already forbids redeclaration/shadowing issues the checker
      // would catch; disable base rules that misfire on interface/type/no-undef for
      // ambient DOM & Electron globals babel doesn't know about.
      "no-redeclare": "off",
      "no-undef": "off",
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: { version: "19" },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // Kicking off `setLoading(true)` at the start of a data-fetching effect is the
      // standard vanilla-React pattern this codebase uses throughout (CatalogView,
      // GlobalSearch, MediaDetailModal, App's dashboard load). The root-cause fix is
      // adopting TanStack Query for request lifecycle management, which is already an
      // approved-but-not-yet-implemented dependency (see README.md tech stack table,
      // CONTEXT.md known issues). Until that lands, keep this as a visible warning
      // rather than a build-breaking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  prettierConfig,
];
