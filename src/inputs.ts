import path from "node:path";
import * as core from "@actions/core";

export interface ActionInputs {
  figmaToken: string;
  figmaFileId: string;
  tokensOutputPath: string | null;
  jsonOutputPath: string | null;
  excludedCollections: Set<string>;
  sdConfigPath: string | null;
  sdTransforms: string[];
  sdOutputFormat: string;
}

export function parseInputs(): ActionInputs {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    core.setFailed("GITHUB_WORKSPACE is not set. Make sure actions/checkout runs before this action.");
    process.exit(1);
  }

  const figmaToken = core.getInput("figma-token", { required: true });
  const figmaFileId = core.getInput("figma-file-id", { required: true });

  const tokensOutputRaw = core.getInput("tokens-output-path").trim();
  const tokensOutputPath = tokensOutputRaw ? path.join(workspace, tokensOutputRaw) : null;

  const jsonOutputRaw = core.getInput("json-output-path").trim();
  const jsonOutputPath = jsonOutputRaw ? path.join(workspace, jsonOutputRaw) : null;

  if (!tokensOutputPath && !jsonOutputPath) {
    core.setFailed("At least one of tokens-output-path or json-output-path must be provided.");
    process.exit(1);
  }

  const excludedCollectionsRaw = core.getInput("excluded-collections");
  const excludedCollections = new Set(
    excludedCollectionsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );

  const sdConfigRaw = core.getInput("style-dictionary-config").trim();
  const sdConfigPath = sdConfigRaw ? path.join(workspace, sdConfigRaw) : null;

  const sdTransforms = core.getInput("sd-transforms")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const sdOutputFormat = core.getInput("sd-output-format") || "json/nested";

  return {
    figmaToken,
    figmaFileId,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections,
    sdConfigPath,
    sdTransforms,
    sdOutputFormat,
  };
}
