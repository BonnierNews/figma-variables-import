import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncFigmaVariables } from "../src/index.ts";

const { FIGMA_TOKEN, FIGMA_FILE_ID } = process.env;

if (!FIGMA_TOKEN) throw new Error("FIGMA_TOKEN is not set");
if (!FIGMA_FILE_ID) throw new Error("FIGMA_FILE_ID is not set");

const dir = path.dirname(fileURLToPath(import.meta.url));

await syncFigmaVariables({
  figmaToken: FIGMA_TOKEN,
  figmaFileId: FIGMA_FILE_ID,
  tokensOutputPath: path.join(dir, "output/tokens"),
  jsonOutputPath: path.join(dir, "output/json"),
  excludedCollections: [ "sizing_appearence", "static-variables", "theme-appearence" ],
});

console.log("Done. Output written to example/output/");
