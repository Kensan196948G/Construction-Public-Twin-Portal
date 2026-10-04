import next from "eslint-config-next";

/**
 * Flat ESLint config.
 * `WebUI/` holds the exported design reference and is not part of the build.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "WebUI/**",
      "public/**",
      "next-env.d.ts",
      "scripts/**",
    ],
  },
  ...next,
];

export default config;
