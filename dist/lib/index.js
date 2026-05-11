// src/figma-api.ts
var FIGMA_API_BASE = "https://api.figma.com/v1";
async function getLocalVariables(fileId, accessToken) {
  const response = await fetch(
    `${FIGMA_API_BASE}/files/${fileId}/variables/local`,
    { headers: { "X-Figma-Token": accessToken } }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Figma API error: ${response.status} ${response.statusText}
${errorText}`
    );
  }
  return response.json();
}

// src/style-dictionary.ts
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import StyleDictionary from "style-dictionary";
function getCollections(tokensDir) {
  if (!fs.existsSync(tokensDir)) return [];
  return fs.readdirSync(tokensDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).filter((e) => fs.readdirSync(path.join(tokensDir, e.name)).some((f) => f.endsWith(".json"))).map((e) => e.name);
}
function getModesForCollection(tokensDir, collection) {
  return fs.readdirSync(path.join(tokensDir, collection)).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
}
function getBrandsForCollection(tokensDir, collection) {
  const colDir = path.join(tokensDir, collection);
  const brands = [];
  const walk = (dir, prefix) => {
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
function getBaseCollectionPaths(tokensDir, collection, mode) {
  const filePath = path.join(tokensDir, collection, `${mode}.json`);
  if (!fs.existsSync(filePath)) return /* @__PURE__ */ new Set();
  const paths = /* @__PURE__ */ new Set();
  const collect = (obj, currentPath = []) => {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "object" && value !== null && "$type" in value) {
        paths.add([...currentPath, key].join("."));
      } else if (typeof value === "object" && value !== null) {
        collect(value, [...currentPath, key]);
      }
    }
  };
  collect(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  return paths;
}
function collectAllTokenFiles(dir) {
  const files = [];
  const walk = (d) => {
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
async function buildBrandCollection(tokensDir, jsonOutputDir, collection, brand, mode, allTokenFiles, sdTransforms, sdOutputFormat) {
  const baseFile = path.join(tokensDir, collection, `${mode}.json`);
  if (!fs.existsSync(baseFile)) return;
  const brandFile = brand === "base" ? baseFile : path.join(tokensDir, collection, brand, `${mode}.json`);
  if (!fs.existsSync(brandFile)) return;
  const buildPath = brand === "base" ? `${path.join(jsonOutputDir, collection)}/` : `${path.join(jsonOutputDir, collection, brand)}/`;
  const basePaths = getBaseCollectionPaths(tokensDir, collection, mode);
  const otherFiles = allTokenFiles.filter((f) => f !== baseFile && f !== brandFile);
  const sd = new StyleDictionary({
    include: brand === "base" ? otherFiles : [...otherFiles, baseFile],
    source: [brandFile],
    platforms: {
      output: {
        transforms: sdTransforms,
        buildPath,
        files: [
          {
            destination: `${mode}.json`,
            format: sdOutputFormat,
            filter: (token) => basePaths.has(token.path.join(".")),
            options: { outputReferences: false }
          }
        ]
      }
    },
    log: { verbosity: "silent", errors: { brokenReferences: "console" } }
  });
  await sd.buildAllPlatforms();
}
async function runStyleDictionary(options) {
  const { tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat } = options;
  if (sdConfigPath) {
    let config;
    if (sdConfigPath.endsWith(".json")) {
      config = JSON.parse(fs.readFileSync(sdConfigPath, "utf-8"));
    } else {
      const mod = await import(pathToFileURL(sdConfigPath).href);
      config = mod.default ?? mod;
    }
    const sd = new StyleDictionary(config);
    await sd.buildAllPlatforms();
    return;
  }
  const collections = getCollections(tokensOutputPath);
  console.log(`Style Dictionary: processing collections: ${collections.join(", ")}`);
  const allTokenFiles = collectAllTokenFiles(tokensOutputPath);
  for (const collection of collections) {
    const modes = getModesForCollection(tokensOutputPath, collection);
    const brands = ["base", ...getBrandsForCollection(tokensOutputPath, collection)];
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

// src/utils.ts
function rgbToHex({ r, g, b, a }) {
  const toHex = (value) => {
    const hex2 = Math.round(value * 255).toString(16);
    return hex2.length === 1 ? `0${hex2}` : hex2;
  };
  const hex = [toHex(r), toHex(g), toHex(b)].join("");
  return `#${hex}${a !== 1 ? toHex(a) : ""}`;
}

// src/token-value.ts
function tokenTypeFromVariable(variable) {
  switch (variable.resolvedType) {
    case "BOOLEAN":
      return "boolean";
    case "COLOR":
      return "color";
    case "FLOAT":
      return "number";
    case "STRING":
      return "string";
    default:
      return "unknown";
  }
}
function tokenValueFromVariable(variable, modeId, localVariables) {
  const value = variable.valuesByMode[modeId];
  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      const aliasedVariable = localVariables[value.id];
      if (aliasedVariable) {
        return `{${aliasedVariable.name.replace(/\//g, ".").replace(/\s+/g, "-")}}`;
      }
      return `{${value.id}}`;
    } else if ("r" in value) {
      return rgbToHex(value);
    }
    throw new Error(`Format of variable value is invalid: ${JSON.stringify(value)}`);
  }
  return value;
}
function getVariableValueForMode(variable, modeId, collection, variables) {
  const ext = collection;
  if (ext.isExtension && ext.variableOverrides) {
    const overrides = ext.variableOverrides[variable.id];
    if (overrides && overrides[modeId]) {
      const overrideValue = overrides[modeId];
      if (typeof overrideValue === "object" && overrideValue !== null) {
        if ("type" in overrideValue && overrideValue.type === "VARIABLE_ALIAS") {
          const aliasedVariable = variables[overrideValue.id];
          if (aliasedVariable) {
            return `{${aliasedVariable.name.replace(/\//g, ".").replace(/\s+/g, "-")}}`;
          }
          return `{${overrideValue.id}}`;
        } else if ("r" in overrideValue) {
          return rgbToHex(overrideValue);
        }
      } else if (overrideValue !== null && overrideValue !== void 0) {
        return overrideValue;
      }
    }
    const mode = collection.modes.find((m) => m.modeId === modeId);
    if (mode && "parentModeId" in mode && mode.parentModeId) {
      return tokenValueFromVariable(variable, mode.parentModeId, variables);
    }
  }
  return tokenValueFromVariable(variable, modeId, variables);
}

// src/token-generation.ts
function collectReferencedVariableIds(variableIds, variables, collected = /* @__PURE__ */ new Set()) {
  for (const varId of variableIds) {
    if (collected.has(varId)) continue;
    const variable = variables[varId];
    if (!variable) continue;
    collected.add(varId);
    for (const modeValue of Object.values(variable.valuesByMode)) {
      if (typeof modeValue === "object" && modeValue !== null && "type" in modeValue) {
        if (modeValue.type === "VARIABLE_ALIAS" && modeValue.id) {
          collectReferencedVariableIds([modeValue.id], variables, collected);
        }
      }
    }
  }
  return collected;
}
function generateTokenForVariable(variable, modeId, modeName, collection, variables, tokenFiles) {
  if (variable.deletedButReferenced) return;
  const sanitizedMode = modeName.replace(/\s+(.)/g, (_, c) => c.toUpperCase());
  const fileName = `${sanitizedMode}.json`;
  if (!tokenFiles[fileName]) {
    tokenFiles[fileName] = {};
  }
  let obj = tokenFiles[fileName];
  variable.name.split("/").forEach((part) => {
    const groupName = part.replace(/\s+/g, "-");
    if (!obj[groupName]) {
      obj[groupName] = {};
    }
    obj = obj[groupName];
  });
  let value;
  if (collection) {
    value = getVariableValueForMode(variable, modeId, collection, variables);
  } else {
    value = tokenValueFromVariable(variable, modeId, variables);
  }
  const token = {
    $type: tokenTypeFromVariable(variable),
    $value: value
  };
  if (variable.description) {
    token.$description = variable.description;
  }
  token.$extensions = {
    "com.figma": {
      hiddenFromPublishing: variable.hiddenFromPublishing,
      scopes: variable.scopes,
      codeSyntax: variable.codeSyntax
    }
  };
  Object.assign(obj, token);
}
function tokenFilesFromLocalVariables(localVariablesResponse, excludedCollections) {
  const brandTokenFiles = {};
  const { variableCollections, variables } = localVariablesResponse.meta;
  const baseCollections = Object.values(variableCollections).filter(
    (c) => !c.remote && !c.isExtension && !excludedCollections.has(c.name)
  );
  for (const baseCollection of baseCollections) {
    const collectionName = baseCollection.name;
    const baseVariableIds = baseCollection.variableIds;
    const baseReferencedIds = collectReferencedVariableIds(baseVariableIds, variables);
    brandTokenFiles[collectionName] ??= {};
    for (const mode of baseCollection.modes) {
      for (const varId of baseVariableIds) {
        const variable = variables[varId];
        if (!variable) continue;
        generateTokenForVariable(
          variable,
          mode.modeId,
          mode.name,
          baseCollection,
          variables,
          brandTokenFiles[collectionName]
        );
      }
      for (const varId of baseReferencedIds) {
        if (baseVariableIds.includes(varId)) continue;
        const variable = variables[varId];
        if (!variable) continue;
        const varCollection = variableCollections[variable.variableCollectionId];
        if (!varCollection || excludedCollections.has(varCollection.name)) continue;
        brandTokenFiles[varCollection.name] ??= {};
        const varMode = varCollection?.modes.find((m) => m.name === mode.name) ?? varCollection?.modes[0];
        if (varMode) {
          generateTokenForVariable(
            variable,
            varMode.modeId,
            mode.name,
            null,
            variables,
            brandTokenFiles[varCollection.name]
          );
        }
      }
    }
  }
  const allBaseModeNames = new Set(
    baseCollections.flatMap((c) => c.modes.map((m) => m.name))
  );
  const extensionCollections = Object.values(variableCollections).filter(
    (c) => !c.remote && c.isExtension === true && !excludedCollections.has(c.name) && c.modes.every((m) => allBaseModeNames.has(m.name))
  );
  const processedCollections = /* @__PURE__ */ new Map();
  for (const bc of baseCollections) {
    processedCollections.set(bc.id, bc.name);
  }
  const processExtensionCollection = (extCollection, dirKey) => {
    const extVariableIds = extCollection.variableIds;
    const allReferencedIds = new Set(extVariableIds);
    for (const overrides of Object.values(extCollection.variableOverrides ?? {})) {
      for (const modeOverride of Object.values(overrides)) {
        if (modeOverride && typeof modeOverride === "object" && "type" in modeOverride && modeOverride.type === "VARIABLE_ALIAS") {
          collectReferencedVariableIds([modeOverride.id], variables, allReferencedIds);
        }
      }
    }
    collectReferencedVariableIds(extVariableIds, variables, allReferencedIds);
    brandTokenFiles[dirKey] ??= {};
    for (const mode of extCollection.modes) {
      for (const varId of extVariableIds) {
        const variable = variables[varId];
        if (!variable) continue;
        generateTokenForVariable(
          variable,
          mode.modeId,
          mode.name,
          extCollection,
          variables,
          brandTokenFiles[dirKey]
        );
      }
      for (const varId of allReferencedIds) {
        if (extVariableIds.includes(varId)) continue;
        const variable = variables[varId];
        if (!variable) continue;
        const varCollection = variableCollections[variable.variableCollectionId];
        if (!varCollection || excludedCollections.has(varCollection.name)) continue;
        const varMode = varCollection?.modes.find((m) => m.name === mode.name) ?? varCollection?.modes[0];
        if (varMode) {
          generateTokenForVariable(
            variable,
            varMode.modeId,
            mode.name,
            null,
            variables,
            brandTokenFiles[dirKey]
          );
        }
      }
      for (const overriddenVarId of Object.keys(extCollection.variableOverrides ?? {})) {
        if (extVariableIds.includes(overriddenVarId)) continue;
        const variable = variables[overriddenVarId];
        if (!variable) continue;
        generateTokenForVariable(
          variable,
          mode.modeId,
          mode.name,
          extCollection,
          variables,
          brandTokenFiles[dirKey]
        );
      }
    }
  };
  let remaining = [...extensionCollections];
  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    const nextRemaining = [];
    for (const extCollection of remaining) {
      const parentId = extCollection.parentVariableCollectionId;
      const parentDirKey = parentId ? processedCollections.get(parentId) : void 0;
      if (parentDirKey !== void 0) {
        const dirKey = `${parentDirKey}/${extCollection.name}`;
        processExtensionCollection(extCollection, dirKey);
        processedCollections.set(extCollection.id, dirKey);
        changed = true;
      } else {
        nextRemaining.push(extCollection);
      }
    }
    remaining = nextRemaining;
  }
  for (const extCollection of remaining) {
    processExtensionCollection(extCollection, extCollection.name);
    processedCollections.set(extCollection.id, extCollection.name);
  }
  return brandTokenFiles;
}

// src/write-tokens.ts
import fs2 from "node:fs";
import path2 from "node:path";
function writeTokenFiles(files, baseDir) {
  fs2.rmSync(baseDir, { recursive: true, force: true });
  for (const [name, tokenFiles] of Object.entries(files)) {
    const entries = Object.entries(tokenFiles);
    if (entries.length === 0) continue;
    const dir = path2.join(baseDir, name);
    fs2.mkdirSync(dir, { recursive: true });
    for (const [fileName, content] of entries) {
      fs2.writeFileSync(path2.join(dir, fileName), JSON.stringify(content, null, 2));
    }
  }
}

// src/index.ts
async function syncFigmaTokens(options) {
  const {
    figmaToken,
    figmaFileId,
    tokensOutputPath,
    jsonOutputPath,
    excludedCollections = /* @__PURE__ */ new Set(),
    sdConfigPath = null,
    sdTransforms = ["attribute/cti", "name/kebab", "size/rem"],
    sdOutputFormat = "json/nested"
  } = options;
  const excludedSet = Array.isArray(excludedCollections) ? new Set(excludedCollections) : excludedCollections;
  const rawData = await getLocalVariables(figmaFileId, figmaToken);
  const tokenFiles = tokenFilesFromLocalVariables(rawData, excludedSet);
  writeTokenFiles(tokenFiles, tokensOutputPath);
  await runStyleDictionary({ tokensOutputPath, jsonOutputPath, sdConfigPath, sdTransforms, sdOutputFormat });
}
export {
  syncFigmaTokens
};
