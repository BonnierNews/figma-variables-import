import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "@actions/core";
import StyleDictionary from "style-dictionary";

import type { ActionInputs } from "./inputs.ts";

function getCollections(tokensDir: string): string[] {
  if (!fs.existsSync(tokensDir)) return [];
  return fs.readdirSync(tokensDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .filter((e) => fs.readdirSync(path.join(tokensDir, e.name)).some((f) => f.endsWith(".json")))
    .map((e) => e.name);
}

function getModesForCollection(tokensDir: string, collection: string): string[] {
  return fs.readdirSync(path.join(tokensDir, collection))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

function getBrandsForCollection(tokensDir: string, collection: string): string[] {
  const colDir = path.join(tokensDir, collection);
  const brands: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      brands.push(relPath);
      walk(path.join(dir, entry.name), relPath);
    }
  };

  walk(colDir, "");
  return brands;
}

function getBaseCollectionPaths(tokensDir: string, collection: string, mode: string): Set<string> {
  const filePath = path.join(tokensDir, collection, `${mode}.json`);
  if (!fs.existsSync(filePath)) return new Set();

  const paths = new Set<string>();
  const collect = (obj: Record<string, unknown>, currentPath: string[] = []): void => {
    for (const [ key, value ] of Object.entries(obj)) {
      if (typeof value === "object" && value !== null && "$type" in value) {
        paths.add([ ...currentPath, key ].join("."));
      } else if (typeof value === "object" && value !== null) {
        collect(value as Record<string, unknown>, [ ...currentPath, key ]);
      }
    }
  };
  collect(JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>);
  return paths;
}

function collectAllTokenFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        walk(path.join(d, entry.name));
      } else if (entry.name.endsWith(".json")) {
        files.push(path.join(d, entry.name));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files;
}

async function buildBrandCollection(
  tokensDir: string,
  jsonOutputDir: string,
  collection: string,
  brand: string,
  mode: string,
  allTokenFiles: string[],
  sdTransforms: string[],
  sdOutputFormat: string
): Promise<void> {
  const baseFile = path.join(tokensDir, collection, `${mode}.json`);
  if (!fs.existsSync(baseFile)) return;

  const brandFile = brand === "base"
    ? baseFile
    : path.join(tokensDir, collection, brand, `${mode}.json`);
  if (!fs.existsSync(brandFile)) return;

  const buildPath = brand === "base"
    ? `${path.join(jsonOutputDir, collection)}/`
    : `${path.join(jsonOutputDir, collection, brand)}/`;

  const basePaths = getBaseCollectionPaths(tokensDir, collection, mode);
  const otherFiles = allTokenFiles.filter((f) => f !== baseFile && f !== brandFile);

  const sd = new StyleDictionary({
    include: brand === "base" ? otherFiles : [ ...otherFiles, baseFile ],
    source: [ brandFile ],
    platforms: {
      output: {
        transforms: sdTransforms,
        buildPath,
        files: [
          {
            destination: `${mode}.json`,
            format: sdOutputFormat,
            filter: (token) => basePaths.has(token.path.join(".")),
            options: { outputReferences: false },
          },
        ],
      },
    },
    log: { verbosity: "silent", errors: { brokenReferences: "console" } },
  });

  await sd.buildAllPlatforms();
}

export async function runStyleDictionary(inputs: ActionInputs): Promise<void> {
  const { tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat } = inputs;

  if (sdConfigPath) {
    const sdTransformsInput = inputs.sdTransforms.join(",");
    const sdOutputFormatInput = inputs.sdOutputFormat;
    if (sdTransformsInput !== "attribute/cti,name/kebab,size/rem" || sdOutputFormatInput !== "json/nested") {
      core.warning(
        "style-dictionary-config is set; sd-transforms and sd-output-format are ignored."
      );
    }

    let config: unknown;
    if (sdConfigPath.endsWith(".json")) {
      config = JSON.parse(fs.readFileSync(sdConfigPath, "utf-8")) as unknown;
    } else {
      const mod = await import(pathToFileURL(sdConfigPath).href) as { default?: unknown };
      config = mod.default ?? mod;
    }

    const sd = new StyleDictionary(config as ConstructorParameters<typeof StyleDictionary>[0]);
    await sd.buildAllPlatforms();
    return;
  }

  const collections = getCollections(tokensOutputPath);
  core.info(`Style Dictionary: processing collections: ${collections.join(", ")}`);

  const allTokenFiles = collectAllTokenFiles(tokensOutputPath);

  for (const collection of collections) {
    const modes = getModesForCollection(tokensOutputPath, collection);
    const brands = [ "base", ...getBrandsForCollection(tokensOutputPath, collection) ];

    try {
      for (const brand of brands) {
        for (const mode of modes) {
          await buildBrandCollection(
            tokensOutputPath,
            jsonOutputPath,
            collection,
            brand,
            mode,
            allTokenFiles,
            sdTransforms,
            sdOutputFormat
          );
        }
      }
    } catch (err) {
      core.warning(`Style Dictionary failed for collection "${collection}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
