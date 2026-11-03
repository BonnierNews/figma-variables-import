import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InputError, syncFigmaVariables } from "../src/index.ts";

const {
  FIGMA_TOKEN,
  FIGMA_FILE_ID,
  INCLUDED_COLLECTIONS = "",
  TOKENS_OUTPUT_PATH,
  JSON_OUTPUT_PATH,
} = process.env;

if (!FIGMA_TOKEN) throw new Error("FIGMA_TOKEN is not set");
if (!FIGMA_FILE_ID) throw new Error("FIGMA_FILE_ID is not set");

const dir = path.dirname(fileURLToPath(import.meta.url));

// .env files don't expand "~", so do it here, then make the path absolute.
const resolveOutputPath = (value: string | undefined, fallback: string): string =>
  value ? path.resolve(value.replace(/^~(?=$|\/)/, os.homedir())) : path.join(dir, fallback);

const tokensOutputPath = resolveOutputPath(TOKENS_OUTPUT_PATH, "output/tokens");
const jsonOutputPath = resolveOutputPath(JSON_OUTPUT_PATH, "output/json");

try {
  await syncFigmaVariables({
    figmaToken: FIGMA_TOKEN,
    figmaFileId: FIGMA_FILE_ID,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections: [ "sizing_appearence", "static-variables", "theme-appearence" ],
    // Optional opt-in filter, e.g. INCLUDED_COLLECTIONS="DN WEB" or "* WEB,* APP"
    includedCollections: INCLUDED_COLLECTIONS.split(",").map((s) => s.trim()).filter(Boolean),
  });
} catch (err) {
  // Bad input (e.g. a misspelled collection name): show the message only, no stack trace.
  if (err instanceof InputError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

console.log(`Done. Tokens written to ${tokensOutputPath}, JSON written to ${jsonOutputPath}`);
