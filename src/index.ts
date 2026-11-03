import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIncludedCollectionsFilter } from "./collection-filter.ts";
import { getLocalVariables } from "./figma-api.ts";
import { runStyleDictionary } from "./style-dictionary.ts";
import { tokenFilesFromLocalVariables } from "./token-generation.ts";
import { tokenFilesFromStyles } from "./style-generation.ts";
import { writeTokenFiles } from "./write-tokens.ts";

export { InputError } from "./collection-filter.ts";

export interface SyncOptions {
  figmaToken: string;
  figmaFileId: string;
  /** Absolute path where raw W3C token JSON files are written. Omit to skip writing them. */
  tokensOutputPath?: string;
  /** Absolute path where Style Dictionary output is written. Omit to skip running Style Dictionary. */
  jsonOutputPath?: string;
  /** Collection names to skip entirely */
  excludedCollections?: Set<string> | string[];
  /**
   * Opt-in filter: extension collection names to include (case-insensitive, "*" wildcard).
   * Base collections, plus ancestors and descendants of matched collections, are kept;
   * other extension collections are dropped. Empty/omitted includes everything.
   */
  includedCollections?: Set<string> | string[];
  /** Whether to import Figma styles (FILL/TEXT/EFFECT) in addition to variables (default: true) */
  includeStyles?: boolean;
  /** Path to a Style Dictionary v5 config file. Takes full precedence over sdTransforms/sdOutputFormat when set */
  sdConfigPath?: string;
  /** Style Dictionary transform names to apply (default: attribute/cti, name/kebab, size/rem) */
  sdTransforms?: string[];
  /** Style Dictionary output format (default: json/nested) */
  sdOutputFormat?: string;
}

export async function syncFigmaVariables(options: SyncOptions): Promise<void> {
  const {
    figmaToken,
    figmaFileId,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections = new Set(),
    includedCollections = [],
    includeStyles = true,
    sdConfigPath = null,
    sdTransforms = [ "attribute/cti", "name/kebab", "size/rem" ],
    sdOutputFormat = "json/nested",
  } = options;

  if (!tokensOutputPath && !jsonOutputPath) {
    throw new Error("At least one of tokensOutputPath or jsonOutputPath must be provided.");
  }

  const excludedSet = Array.isArray(excludedCollections)
    ? new Set(excludedCollections)
    : excludedCollections;

  const rawData = await getLocalVariables(figmaFileId, figmaToken);
  const isIncluded = createIncludedCollectionsFilter(rawData.meta.variableCollections, includedCollections);
  const variableTokenFiles = tokenFilesFromLocalVariables(rawData, excludedSet, isIncluded);
  const tokenFiles: import("./types.ts").BrandTokenFiles = {};
  for (const [ key, value ] of Object.entries(variableTokenFiles)) {
    tokenFiles[`variables/${key}`] = value;
  }

  if (includeStyles) {
    const styleTokenFiles = await tokenFilesFromStyles(figmaFileId, figmaToken, rawData, isIncluded);
    Object.assign(tokenFiles, styleTokenFiles);
  }

  let tempTokensDir: string | null = null;
  try {
    const tokensDir = tokensOutputPath
      ?? (tempTokensDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-variables-")));

    writeTokenFiles(tokenFiles, tokensDir);

    if (jsonOutputPath) {
      await runStyleDictionary({
        tokensOutputPath: tokensDir,
        jsonOutputPath,
        sdConfigPath,
        sdTransforms,
        sdOutputFormat,
      });
    }
  } finally {
    if (tempTokensDir) fs.rmSync(tempTokensDir, { recursive: true, force: true });
  }
}
