import type { LocalVariable, LocalVariableCollection, RGBA } from "@figma/rest-api-spec";

import type { FigmaCollectionExtras } from "./types.ts";
import { rgbToHex } from "./utils.ts";

export function tokenTypeFromVariable(variable: LocalVariable): string {
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

export function tokenValueFromVariable(
  variable: LocalVariable,
  modeId: string,
  localVariables: Record<string, LocalVariable>
): string | number | boolean {
  const value = variable.valuesByMode[modeId];

  if (typeof value === "object" && value !== null) {
    if ("type" in value && value.type === "VARIABLE_ALIAS") {
      const aliasedVariable = localVariables[value.id];
      if (aliasedVariable) {
        return `{${aliasedVariable.name.replace(/\//g, ".").replace(/\s+/g, "-")}}`;
      }
      return `{${value.id}}`;
    } else if ("r" in value) {
      return rgbToHex(value as RGBA);
    }

    throw new Error(`Format of variable value is invalid: ${JSON.stringify(value)}`);
  }

  return value;
}

export function getVariableValueForMode(
  variable: LocalVariable,
  modeId: string,
  collection: LocalVariableCollection,
  variables: Record<string, LocalVariable>
): string | number | boolean {
  const ext = collection as LocalVariableCollection & FigmaCollectionExtras;

  if (ext.isExtension && ext.variableOverrides) {
    const overrides = ext.variableOverrides[variable.id];
    if (overrides && overrides[modeId]) {
      const overrideValue = overrides[modeId];
      if (typeof overrideValue === "object" && overrideValue !== null) {
        if ("type" in overrideValue && overrideValue.type === "VARIABLE_ALIAS") {
          const aliasedVariable = variables[(overrideValue as { id: string }).id];
          if (aliasedVariable) {
            return `{${aliasedVariable.name.replace(/\//g, ".").replace(/\s+/g, "-")}}`;
          }
          return `{${(overrideValue as { id: string }).id}}`;
        } else if ("r" in overrideValue) {
          return rgbToHex(overrideValue as RGBA);
        }
      } else if (overrideValue !== null && overrideValue !== undefined) {
        return overrideValue as string | number | boolean;
      }
    }

    const mode = collection.modes.find((m) => m.modeId === modeId);
    if (mode && "parentModeId" in mode && mode.parentModeId) {
      return tokenValueFromVariable(variable, mode.parentModeId as string, variables);
    }
  }

  return tokenValueFromVariable(variable, modeId, variables);
}
