import * as core from "@actions/core";

import { getLocalVariables } from "./figma-api.ts";
import { parseInputs } from "./inputs.ts";
import { runStyleDictionary } from "./style-dictionary.ts";
import { tokenFilesFromLocalVariables } from "./token-generation.ts";
import { writeTokenFiles } from "./write-tokens.ts";

async function main(): Promise<void> {
  const inputs = parseInputs();

  core.info(`Fetching variables from Figma file: ${inputs.figmaFileId}`);
  const rawData = await getLocalVariables(inputs.figmaFileId, inputs.figmaToken);

  const { variableCollections, variables } = rawData.meta;
  core.info(`Collections: ${Object.keys(variableCollections).length}, Variables: ${Object.keys(variables).length}`);

  const tokenFiles = tokenFilesFromLocalVariables(rawData, inputs.excludedCollections);

  core.info(`Writing token files to ${inputs.tokensOutputPath}`);
  writeTokenFiles(tokenFiles, inputs.tokensOutputPath);

  core.info(`Running Style Dictionary → ${inputs.jsonOutputPath}`);
  await runStyleDictionary({
    tokensOutputPath: inputs.tokensOutputPath,
    jsonOutputPath: inputs.jsonOutputPath,
    sdConfigPath: inputs.sdConfigPath,
    sdTransforms: inputs.sdTransforms,
    sdOutputFormat: inputs.sdOutputFormat,
  });
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
