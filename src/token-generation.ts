import type {
  GetLocalVariablesResponse,
  LocalVariable,
  LocalVariableCollection,
} from "@figma/rest-api-spec";

import type { Token, TokensFile, BrandTokenFiles, FigmaCollectionExtras } from "./types.ts";
import { tokenTypeFromVariable, tokenValueFromVariable, getVariableValueForMode } from "./token-value.ts";

export function collectReferencedVariableIds(
  variableIds: string[],
  variables: Record<string, LocalVariable>,
  collected: Set<string> = new Set()
): Set<string> {
  for (const varId of variableIds) {
    if (collected.has(varId)) continue;

    const variable = variables[varId];
    if (!variable) continue;

    collected.add(varId);

    for (const modeValue of Object.values(variable.valuesByMode)) {
      if (typeof modeValue === "object" && modeValue !== null && "type" in modeValue) {
        if (modeValue.type === "VARIABLE_ALIAS" && modeValue.id) {
          collectReferencedVariableIds([ modeValue.id ], variables, collected);
        }
      }
    }
  }

  return collected;
}

export function generateTokenForVariable(
  variable: LocalVariable,
  modeId: string,
  modeName: string,
  collection: LocalVariableCollection | null,
  variables: Record<string, LocalVariable>,
  tokenFiles: Record<string, TokensFile>
): void {
  if (variable.deletedButReferenced) return;

  const sanitizedMode = modeName.replace(/\s+(.)/g, (_, c: string) => c.toUpperCase());
  const fileName = `${sanitizedMode}.json`;

  if (!tokenFiles[fileName]) {
    tokenFiles[fileName] = {};
  }

  let obj: TokensFile = tokenFiles[fileName];

  variable.name.split("/").forEach((part) => {
    const groupName = part.replace(/\s+/g, "-");
    if (!obj[groupName]) {
      obj[groupName] = {};
    }
    obj = obj[groupName] as TokensFile;
  });

  let value: string | number | boolean;
  if (collection) {
    value = getVariableValueForMode(variable, modeId, collection, variables);
  } else {
    value = tokenValueFromVariable(variable, modeId, variables);
  }

  const token: Token = {
    $type: tokenTypeFromVariable(variable),
    $value: value,
  };

  if (variable.description) {
    token.$description = variable.description;
  }

  token.$extensions = {
    "com.figma": {
      hiddenFromPublishing: variable.hiddenFromPublishing,
      scopes: variable.scopes,
      codeSyntax: variable.codeSyntax,
    },
  };

  Object.assign(obj, token);
}

export function tokenFilesFromLocalVariables(
  localVariablesResponse: GetLocalVariablesResponse,
  excludedCollections: Set<string>
): BrandTokenFiles {
  const brandTokenFiles: BrandTokenFiles = {};
  const { variableCollections, variables } = localVariablesResponse.meta;

  type ExtCollection = LocalVariableCollection & FigmaCollectionExtras;

  const baseCollections = Object.values(variableCollections).filter(
    (c): c is ExtCollection =>
      !c.remote &&
      !(c as ExtCollection).isExtension &&
      !excludedCollections.has(c.name)
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

  // Extension collections — wave-based processing using parentVariableCollectionId
  const allBaseModeNames = new Set(
    baseCollections.flatMap((c) => c.modes.map((m) => m.name))
  );
  const extensionCollections = Object.values(variableCollections).filter(
    (c): c is ExtCollection =>
      !c.remote &&
      (c as ExtCollection).isExtension === true &&
      !excludedCollections.has(c.name) &&
      c.modes.every((m) => allBaseModeNames.has(m.name))
  );

  const processedCollections = new Map<string, string>();
  for (const bc of baseCollections) {
    processedCollections.set(bc.id, bc.name);
  }

  const processExtensionCollection = (extCollection: ExtCollection, dirKey: string): void => {
    const extVariableIds = extCollection.variableIds;

    const allReferencedIds = new Set<string>(extVariableIds);

    for (const overrides of Object.values(extCollection.variableOverrides ?? {})) {
      for (const modeOverride of Object.values(overrides)) {
        if (modeOverride && typeof modeOverride === "object" && "type" in modeOverride && modeOverride.type === "VARIABLE_ALIAS") {
          collectReferencedVariableIds([ (modeOverride as { id: string }).id ], variables, allReferencedIds);
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

  let remaining = [ ...extensionCollections ];
  let changed = true;

  while (changed && remaining.length > 0) {
    changed = false;
    const nextRemaining: typeof remaining = [];

    for (const extCollection of remaining) {
      const parentId = extCollection.parentVariableCollectionId;
      const parentDirKey = parentId ? processedCollections.get(parentId) : undefined;

      if (parentDirKey !== undefined) {
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
