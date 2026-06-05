import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import StyleDictionary from "style-dictionary";

export interface StyleDictionaryOptions {
  tokensOutputPath: string;
  jsonOutputPath: string;
  sdConfigPath: string | null;
  sdTransforms: string[];
  sdOutputFormat: string;
}

// A directory is a "collection" if it has .json files directly and does NOT share mode names
// with its parent. If mode names overlap with the parent, it is a brand of that parent instead.
function getCollections(tokensDir: string): string[] {
  if (!fs.existsSync(tokensDir)) return [];
  const result: string[] = [];

  const walk = (dir: string, relPath: string, parentModes: Set<string>): Set<string> => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const myModes = new Set(
      entries
        .filter((e) => !e.isDirectory() && e.name.endsWith(".json"))
        .map((e) => e.name.replace(".json", ""))
    );
    const isCollection = myModes.size > 0 && [ ...myModes ].every((m) => !parentModes.has(m));
    if (isCollection && relPath !== "") result.push(relPath);

    const modesForChildren = isCollection ? myModes : parentModes;
    for (const entry of entries.filter((e) => e.isDirectory() && !e.name.startsWith("."))) {
      walk(path.join(dir, entry.name), relPath ? `${relPath}/${entry.name}` : entry.name, modesForChildren);
    }
    return myModes;
  };

  walk(tokensDir, "", new Set());
  return result;
}

function getModesForCollection(tokensDir: string, collection: string): string[] {
  return fs.readdirSync(path.join(tokensDir, collection), { withFileTypes: true })
    .filter((e) => !e.isDirectory() && e.name.endsWith(".json"))
    .map((e) => e.name.replace(".json", ""));
}

function getBrandsForCollection(tokensDir: string, collection: string): string[] {
  const colDir = path.join(tokensDir, collection);
  const collectionModes = new Set(getModesForCollection(tokensDir, collection));
  const brands: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const subModes = new Set(
        fs.readdirSync(path.join(dir, entry.name), { withFileTypes: true })
          .filter((e) => !e.isDirectory() && e.name.endsWith(".json"))
          .map((e) => e.name.replace(".json", ""))
      );
      // Only treat as brand if its modes overlap with the collection's modes
      if ([ ...subModes ].some((m) => collectionModes.has(m))) {
        brands.push(relPath);
        walk(path.join(dir, entry.name), relPath);
      }
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
  // Same names can appear under both variables/ (as variable groups whose
  // children are individual properties) and styles/ (as composite tokens with
  // a single $value). Including styles/ files when building a variables/
  // collection makes the merge tree turn the shared path into a leaf with
  // $value, hiding the variable children from the filter and dropping them
  // from the output. The reverse direction is fine: style outputs DO need
  // variables/ files in `include` so cross-domain references like
  // {typography.font-family.serif.serif-headline} resolve.
  const isVariablesCollection = collection === "variables" || collection.startsWith("variables/");
  const stylesPrefix = `${path.join(tokensDir, "styles")}${path.sep}`;
  const otherFiles = allTokenFiles.filter((f) =>
    f !== baseFile && f !== brandFile && !(isVariablesCollection && f.startsWith(stylesPrefix))
  );

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

export async function runStyleDictionary(options: StyleDictionaryOptions): Promise<void> {
  const { tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat } = options;

  fs.rmSync(path.join(jsonOutputPath, "variables"), { recursive: true, force: true });
  fs.rmSync(path.join(jsonOutputPath, "styles"), { recursive: true, force: true });

  if (sdConfigPath) {
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
  console.log(`Style Dictionary: processing collections: ${collections.join(", ")}`);

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
      console.warn(`Style Dictionary failed for collection "${collection}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
