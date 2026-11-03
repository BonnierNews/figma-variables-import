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
  buildDir: string,
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

  const buildPath = `${buildDir}/`;

  const basePaths = getBaseCollectionPaths(tokensDir, collection, mode);
  // Same names can appear under both variables/ (as variable groups whose
  // children are individual properties) and styles/ (as composite tokens with
  // a single $value). Including styles/ files when building a variables/
  // collection makes the merge tree turn the shared path into a leaf with
  // $value, hiding the variable children from the filter and dropping them
  // from the output. For styles/ collections we currently keep variables/ files in `include`
  // so any Style Dictionary references emitted by style generation can still resolve (if present).
  // If style→variable references are not needed, styles/ collections could exclude variables/ too.
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

// Brand chains are relative to a collection directory, e.g. "DN/DN Web" or "Local/Local App/Casual".
// A final brand is a leaf chain (in any collection) that no other leaf chain extends. Brand depth can
// differ per collection (Color may go down to "Local/Local App/Casual" while Metrics stops at
// "Local/Local App"), so final brands are resolved across all collections, not per collection.
function getFinalBrands(leafChains: string[]): string[] {
  const unique = [ ...new Set(leafChains) ];
  return unique.filter((chain) => !unique.some((other) => other.startsWith(`${chain}/`))).sort();
}

// The deepest chain in a collection that is the final brand itself or one of its ancestors.
// Returns "base" when the collection has no brands at all, null when none of its brands apply.
function resolveBrandForCollection(finalBrand: string, collectionBrands: string[]): string | null {
  if (collectionBrands.length === 0) return "base";
  const candidates = collectionBrands.filter((chain) => chain === finalBrand || finalBrand.startsWith(`${chain}/`));
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.split("/").length > a.split("/").length ? b : a));
}

// Output folder name for a final brand: the top-level group is dropped and the rest is joined
// with spaces ("DN/DN Web" → "DN Web", "Local/Local App/Casual" → "Local App Casual").
function brandFolderName(chain: string): string {
  const segments = chain.split("/");
  return segments.length > 1 ? segments.slice(1).join(" ") : segments[0];
}

function getBrandFolders(finalBrands: string[]): Map<string, string> {
  const folders = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const chain of finalBrands) {
    const name = brandFolderName(chain);
    folders.set(chain, name);
    byName.set(name, [ ...(byName.get(name) ?? []), chain ]);
  }
  const clashes = [ ...byName.entries() ].filter(([ , chains ]) => chains.length > 1);
  if (clashes.length > 0) {
    throw new Error(
      `Style Dictionary: brands would be written to the same folder: ${clashes
        .map(([ name, chains ]) => `"${name}" (${chains.join(", ")})`)
        .join("; ")}`
    );
  }
  return folders;
}

// Removes output from previous runs: the brand-less layout (variables/, styles/) and any brand
// folder, recognised by containing a variables/ or styles/ directory. Other files are left alone.
function cleanJsonOutput(jsonOutputPath: string): void {
  if (!fs.existsSync(jsonOutputPath)) return;
  for (const entry of fs.readdirSync(jsonOutputPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(jsonOutputPath, entry.name);
    const isGenerated = entry.name === "variables"
      || entry.name === "styles"
      || fs.existsSync(path.join(dir, "variables"))
      || fs.existsSync(path.join(dir, "styles"));
    if (isGenerated) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runStyleDictionary(options: StyleDictionaryOptions): Promise<void> {
  const { tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat } = options;

  cleanJsonOutput(jsonOutputPath);

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

  const collections = getCollections(tokensOutputPath).map((collection) => {
    const brands = getBrandsForCollection(tokensOutputPath, collection);
    // Only the lowest level of each brand chain is output: every level's token file is a complete
    // set, so the leaf already holds everything it inherits.
    const leafBrands = brands.filter((brand) => !brands.some((other) => other.startsWith(`${brand}/`)));
    return { collection, brands, leafBrands, modes: getModesForCollection(tokensOutputPath, collection) };
  });

  const finalBrands = getFinalBrands(collections.flatMap((c) => c.leafBrands));
  const brandFolders = getBrandFolders(finalBrands);

  // Each target is one brand folder (or the output root when there are no brands) with one
  // source brand chain per collection.
  const targets = finalBrands.length > 0
    ? finalBrands.map((finalBrand) => ({
      folder: brandFolders.get(finalBrand) as string,
      sources: collections.map((c) => ({ ...c, brand: resolveBrandForCollection(finalBrand, c.brands) })),
    }))
    : [ { folder: "", sources: collections.map((c) => ({ ...c, brand: "base" as string | null })) } ];

  const allTokenFiles = collectAllTokenFiles(tokensOutputPath);

  for (const { folder, sources } of targets) {
    const mapping = sources
      .filter((s) => s.brand !== null)
      .map((s) => `${s.collection}${s.brand === "base" ? "" : ` (${s.brand})`}`);
    console.log(`Style Dictionary: ${folder || "(no brands)"} ← ${mapping.join(", ")}`);

    for (const { collection, brand, modes } of sources) {
      if (brand === null) continue;
      try {
        for (const mode of modes) {
          await buildBrandCollection(
            tokensOutputPath,
            path.join(jsonOutputPath, folder, collection),
            collection,
            brand,
            mode,
            allTokenFiles,
            sdTransforms,
            sdOutputFormat
          );
        }
      } catch (err) {
        console.warn(`Style Dictionary failed for collection "${collection}"${folder ? ` in "${folder}"` : ""}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
