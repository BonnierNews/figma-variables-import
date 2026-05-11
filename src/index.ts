import { getLocalVariables } from "./figma-api.ts";
import { runStyleDictionary } from "./style-dictionary.ts";
import { tokenFilesFromLocalVariables } from "./token-generation.ts";
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
    sdConfigPath = null,
    sdTransforms = [ "attribute/cti", "name/kebab", "size/rem" ],
    sdOutputFormat = "json/nested",
  } = options;

  const excludedSet = Array.isArray(excludedCollections)
    ? new Set(excludedCollections)
    : excludedCollections;

  const rawData = await getLocalVariables(figmaFileId, figmaToken);
  const tokenFiles = tokenFilesFromLocalVariables(rawData, excludedSet);
  writeTokenFiles(tokenFiles, tokensOutputPath);
  await runStyleDictionary({ tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat });
}
