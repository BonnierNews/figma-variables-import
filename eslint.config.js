import config from "@bonniernews/eslint-config";

export default [
  { ignores: [ "dist/", "example/" ] },
  ...config,
  {
    files: [ "src/**/*.ts" ],
    rules: {
      "no-console": "off",
      "n/no-process-exit": "off",
      "import/no-unresolved": [ "error", { ignore: [ "style-dictionary" ] } ],
      "import/extensions": [ "error", "ignorePackages", { ts: "always" } ],
    },
  },
];
