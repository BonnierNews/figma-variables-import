import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@actions/core";

import type { BrandTokenFiles } from "./types.ts";
import { getLocalVariables } from "./figma-api.ts";
import { parseInputs } from "./inputs.ts";
import { runStyleDictionary } from "./style-dictionary.ts";
import { tokenFilesFromLocalVariables } from "./token-generation.ts";
import { tokenFilesFromStyles } from "./style-generation.ts";
import { writeTokenFiles } from "./write-tokens.ts";

async function main(): Promise<void> {
  const inputs = parseInputs();

  core.info(`Fetching variables from Figma file: ${inputs.figmaFileId}`);
  const rawData = await getLocalVariables(inputs.figmaFileId, inputs.figmaToken);

  const { variableCollections, variables } = rawData.meta;
  core.info(`Collections: ${Object.keys(variableCollections).length}, Variables: ${Object.keys(variables).length}`);

  const variableTokenFiles = tokenFilesFromLocalVariables(rawData, inputs.excludedCollections);
  const tokenFiles: BrandTokenFiles = {};
  for (const [ key, value ] of Object.entries(variableTokenFiles)) {
    tokenFiles[`variables/${key}`] = value;
  }

  core.info(`Fetching styles from Figma file: ${inputs.figmaFileId}`);
  const styleTokenFiles = await tokenFilesFromStyles(inputs.figmaFileId, inputs.figmaToken, rawData);
  core.info(`Styles: ${Object.keys(styleTokenFiles).join(", ")}`);
  Object.assign(tokenFiles, styleTokenFiles);

  let tempTokensDir: string | null = null;
  try {
    const tokensDir = inputs.tokensOutputPath
      ?? (tempTokensDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-tokens-")));

    if (inputs.tokensOutputPath) {
      core.info(`Writing token files to ${inputs.tokensOutputPath}`);
    } else {
      core.info("Skipping W3C token export (no tokens-output-path provided)");
    }
    writeTokenFiles(tokenFiles, tokensDir, inputs.tokensOutputPath ? inputs.cleanTokensOutput : false);

    if (inputs.jsonOutputPath) {
      core.info(`Running Style Dictionary → ${inputs.jsonOutputPath}`);
      await runStyleDictionary({
        tokensOutputPath: tokensDir,
        jsonOutputPath: inputs.jsonOutputPath,
        sdConfigPath: inputs.sdConfigPath,
        sdTransforms: inputs.sdTransforms,
        sdOutputFormat: inputs.sdOutputFormat,
        clean: inputs.cleanJsonOutput,
      });
    } else {
      core.info("Skipping Style Dictionary (no json-output-path provided)");
    }
  } finally {
    if (tempTokensDir) fs.rmSync(tempTokensDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
