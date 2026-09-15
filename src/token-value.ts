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

// Figma returns a color with opacity as a COMPOSE_COLOR expression instead of an RGBA
// value. @figma/rest-api-spec does not type it (as of 0.42.0), so declare it here.
interface VariableExpression {
  type: "VARIABLE_EXPRESSION";
  expressionFunction: string;
  expressionArguments: unknown[];
}

function isVariableExpression(value: unknown): value is VariableExpression {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type === "VARIABLE_EXPRESSION"
  );
}

// Figma now returns a color with opacity as a { color, opacity } object instead of a
// COMPOSE_COLOR expression. @figma/rest-api-spec does not type it (as of 0.42.0).
interface ComposeColorValue {
  color: unknown;
  opacity: number;
}

function isComposeColorValue(value: unknown): value is ComposeColorValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "color" in value &&
    "opacity" in value &&
    typeof (value as { opacity: unknown }).opacity === "number"
  );
}

function isVariableAlias(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type === "VARIABLE_ALIAS"
  );
}

function rgbaFromRawValue(
  value: unknown,
  modeId: string,
  localVariables: Record<string, LocalVariable>,
  seen: Set<string>
): RGBA | null {
  if (isVariableExpression(value)) {
    return rgbaFromComposeColor(value, modeId, localVariables, seen);
  }

  if (isComposeColorValue(value)) {
    const base = rgbaFromRawValue(value.color, modeId, localVariables, seen);
    if (!base) return null;

    return { ...base, a: base.a * (value.opacity / 100) };
  }

  if (isVariableAlias(value)) {
    if (seen.has(value.id)) return null;
    seen.add(value.id);

    const aliasedVariable = localVariables[value.id];
    if (!aliasedVariable) return null;

    const aliasedValue = aliasedVariable.valuesByMode[modeId]
      ?? Object.values(aliasedVariable.valuesByMode)[0];
    return rgbaFromRawValue(aliasedValue, modeId, localVariables, seen);
  }

  if (typeof value === "object" && value !== null && "r" in value) {
    const { r, g, b, a } = value as RGBA;
    return { r, g, b, a: typeof a === "number" ? a : 1 };
  }

  return null;
}

/** COMPOSE_COLOR(baseColor, opacity) — opacity is a percentage (0-100) applied to the base alpha. */
function rgbaFromComposeColor(
  expression: VariableExpression,
  modeId: string,
  localVariables: Record<string, LocalVariable>,
  seen: Set<string>
): RGBA | null {
  if (expression.expressionFunction !== "COMPOSE_COLOR") return null;

  const [ baseArgument, opacityArgument ] = expression.expressionArguments;
  if (typeof opacityArgument !== "number") return null;

  const base = rgbaFromRawValue(baseArgument, modeId, localVariables, seen);
  if (!base) return null;

  return { ...base, a: base.a * (opacityArgument / 100) };
}

function hexFromComposeColorValue(
  value: ComposeColorValue,
  modeId: string,
  localVariables: Record<string, LocalVariable>
): string {
  const rgba = rgbaFromRawValue(value, modeId, localVariables, new Set());
  if (!rgba) {
    throw new Error(`Could not resolve color value: ${JSON.stringify(value)}`);
  }

  return rgbToHex(rgba);
}

function hexFromVariableExpression(
  expression: VariableExpression,
  modeId: string,
  localVariables: Record<string, LocalVariable>
): string {
  const rgba = rgbaFromComposeColor(expression, modeId, localVariables, new Set());
  if (!rgba) {
    throw new Error(`Could not resolve variable expression: ${JSON.stringify(expression)}`);
  }

  return rgbToHex(rgba);
}

export function tokenValueFromVariable(
  variable: LocalVariable,
  modeId: string,
  localVariables: Record<string, LocalVariable>
): string | number | boolean {
  const value = variable.valuesByMode[modeId];

  if (typeof value === "object" && value !== null) {
    if (isVariableExpression(value)) {
      return hexFromVariableExpression(value, modeId, localVariables);
    } else if (isComposeColorValue(value)) {
      return hexFromComposeColorValue(value, modeId, localVariables);
    } else if ("type" in value && value.type === "VARIABLE_ALIAS") {
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
        if (isVariableExpression(overrideValue)) {
          return hexFromVariableExpression(overrideValue, modeId, variables);
        } else if (isComposeColorValue(overrideValue)) {
          return hexFromComposeColorValue(overrideValue, modeId, variables);
        } else if ("type" in overrideValue && overrideValue.type === "VARIABLE_ALIAS") {
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

/** Figma stores opacity variables as percentages (0-100); tokens express them as 0-1. */
export function isPercentageOpacity(variable: LocalVariable): boolean {
  return variable.resolvedType === "FLOAT" && variable.scopes.includes("OPACITY");
}
