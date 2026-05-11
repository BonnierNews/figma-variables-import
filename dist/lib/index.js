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
import fs from "node:fs";
import path from "node:path";
function writeTokenFiles(files, baseDir) {
  fs.rmSync(baseDir, { recursive: true, force: true });
  for (const [name, tokenFiles] of Object.entries(files)) {
    const entries = Object.entries(tokenFiles);
    if (entries.length === 0) continue;
    const dir = path.join(baseDir, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [fileName, content] of entries) {
      fs.writeFileSync(path.join(dir, fileName), JSON.stringify(content, null, 2));
    }
  }
}
export {
  collectReferencedVariableIds,
  generateTokenForVariable,
  getLocalVariables,
  getVariableValueForMode,
  rgbToHex,
  tokenFilesFromLocalVariables,
  tokenTypeFromVariable,
  tokenValueFromVariable,
  writeTokenFiles
};
