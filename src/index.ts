import { getLocalVariables } from "./figma-api.ts";
import { runStyleDictionary } from "./style-dictionary.ts";
import { tokenFilesFromLocalVariables } from "./token-generation.ts";
import { tokenFilesFromStyles } from "./style-generation.ts";
import { writeTokenFiles } from "./write-tokens.ts";

export interface SyncOptions {
  figmaToken: string;
  figmaFileId: string;
  /** Absolute path where raw W3C token JSON files are written */
  tokensOutputPath: string;
  /** Absolute path where Style Dictionary output is written */
  jsonOutputPath: string;
  /** Collection names to skip entirely */
  excludedCollections?: Set<string> | string[];
  /** Whether to import Figma styles (FILL/TEXT/EFFECT) in addition to variables (default: true) */
  includeStyles?: boolean;
  /** Path to a Style Dictionary v5 config file. Takes full precedence over sdTransforms/sdOutputFormat when set */
  sdConfigPath?: string;
  /** Style Dictionary transform names to apply (default: attribute/cti, name/kebab, size/rem) */
  sdTransforms?: string[];
  /** Style Dictionary output format (default: json/nested) */
  sdOutputFormat?: string;
}

export async function syncFigmaTokens(options: SyncOptions): Promise<void> {
  const {
    figmaToken,
    figmaFileId,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections = new Set(),
    includeStyles = true,
    sdConfigPath = null,
    sdTransforms = [ "attribute/cti", "name/kebab", "size/rem" ],
    sdOutputFormat = "json/nested",
  } = options;

  const excludedSet = Array.isArray(excludedCollections)
    ? new Set(excludedCollections)
    : excludedCollections;

  const rawData = await getLocalVariables(figmaFileId, figmaToken);
  const variableTokenFiles = tokenFilesFromLocalVariables(rawData, excludedSet);
  const tokenFiles: import("./types.ts").BrandTokenFiles = {};
  for (const [ key, value ] of Object.entries(variableTokenFiles)) {
    tokenFiles[`variables/${key}`] = value;
  }

  if (includeStyles) {
    const styleTokenFiles = await tokenFilesFromStyles(figmaFileId, figmaToken, rawData);
    Object.assign(tokenFiles, styleTokenFiles);
  }

  writeTokenFiles(tokenFiles, tokensOutputPath);
  await runStyleDictionary({ tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat });
}
