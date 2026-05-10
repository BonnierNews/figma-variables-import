import path from "node:path";
import * as core from "@actions/core";

export interface ActionInputs {
  figmaToken: string;
  figmaFileId: string;
  tokensOutputPath: string;
  jsonOutputPath: string;
  excludedCollections: Set<string>;
  sdConfigPath: string | null;
  sdTransforms: string[];
  sdOutputFormat: string;
  commitMessage: string;
  gitUserName: string;
  gitUserEmail: string;
}

export function parseInputs(): ActionInputs {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) {
    core.setFailed("GITHUB_WORKSPACE is not set. Make sure actions/checkout runs before this action.");
    process.exit(1);
  }

  const figmaToken = core.getInput("figma-token", { required: true });
  const figmaFileId = core.getInput("figma-file-id", { required: true });

  const tokensOutputPath = path.join(workspace, core.getInput("tokens-output-path") || "design-tokens/tokens");
  const jsonOutputPath = path.join(workspace, core.getInput("json-output-path") || "design-tokens/json");

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

  const commitMessage = core.getInput("commit-message") || "chore: update design tokens from Figma";
  const gitUserName = core.getInput("git-user-name") || "github-actions[bot]";
  const gitUserEmail = core.getInput("git-user-email") || "github-actions[bot]@users.noreply.github.com";

  return {
    figmaToken,
    figmaFileId,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections,
    sdConfigPath,
    sdTransforms,
    sdOutputFormat,
    commitMessage,
    gitUserName,
    gitUserEmail,
  };
}
