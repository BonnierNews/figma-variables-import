import type { GetLocalVariablesResponse, LocalVariable, LocalVariableCollection, RGBA } from "@figma/rest-api-spec";

import type { Token, TokensFile, BrandTokenFiles, TokenValue, FigmaCollectionExtras } from "./types.ts";
import { getFileStyles, getFileNodes } from "./figma-api.ts";
import { tokenValueFromVariable, getVariableValueForMode } from "./token-value.ts";
import { rgbToHex } from "./utils.ts";

const STYLES_BRAND_KEY = "styles";
const TYPOGRAPHY_BRAND_KEY = "styles/typography";
const EFFECT_BRAND_KEY = "styles/effect";
const COLOR_BRAND_KEY = "styles/color";

type VariableAlias = { type: string; id: string };
type ExtCollection = LocalVariableCollection & FigmaCollectionExtras;

interface ModeContext {
  collection: ExtCollection | null;
  modeId: string;
  brandKey: string;
  fileName: string;
}

function gradientAngle(handles: Array<{ x: number; y: number }>): string {
  const [ p0, p1 ] = handles;
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) * (180 / Math.PI) + 90;
  return String(((angle % 360) + 360) % 360);
}

interface FillDoc {
  fills?: Array<{
    type: string;
    color?: RGBA;
    gradientStops?: Array<{ color: RGBA; position: number; boundVariables?: { color?: VariableAlias } }>;
    gradientHandlePositions?: Array<{ x: number; y: number }>;
    boundVariables?: { color?: VariableAlias };
  }>;
}

interface TextDoc {
  style?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: string;
    lineHeightPx?: number;
    letterSpacing?: number;
    textCase?: string;
    // Figma may put typography variable bindings inside style
    boundVariables?: Record<string, VariableAlias | VariableAlias[]>;
  };
  // Figma may also put them at the top level
  boundVariables?: Record<string, VariableAlias | VariableAlias[]>;
}

interface EffectDoc {
  effects?: Array<{
    type: string;
    color?: RGBA;
    offset?: { x: number; y: number };
    radius?: number;
    spread?: number;
    boundVariables?: { color?: VariableAlias };
  }>;
}

interface StyleDoc extends FillDoc, TextDoc, EffectDoc {
  name: string;
  description?: string;
}

function modeFileName(modeName: string): string {
  return `${modeName.replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())}.json`;
}

function resolveAlias(bound: VariableAlias | VariableAlias[]): VariableAlias {
  return Array.isArray(bound) ? bound[0] : bound;
}

// Merge boundVariables from the node root and from inside style (Figma puts them in either place).
function allBoundVariables(doc: TextDoc): Record<string, VariableAlias | VariableAlias[]> {
  return { ...(doc.style?.boundVariables ?? {}), ...(doc.boundVariables ?? {}) };
}

// Walk the collection hierarchy starting from baseCollectionId, depth-first.
// Produces one ModeContext per (collection × mode), with brandKey paths rooted
// at baseBrandKey (e.g. "styles/typography" or "styles/effect"), so base modes
// and brand-extension modes each get their own file.
function buildModeContexts(
  baseCollectionId: string,
  variableCollections: Record<string, LocalVariableCollection>,
  baseBrandKey: string
): ModeContext[] {
  const allCollections = variableCollections as Record<string, ExtCollection>;
  const contexts: ModeContext[] = [];

  function walk(collId: string, brandKey: string): void {
    const collection = allCollections[collId];
    if (!collection) return;

    const isBase = brandKey === baseBrandKey;
    for (const mode of collection.modes) {
      contexts.push({
        collection: isBase ? null : collection,
        modeId: mode.modeId,
        brandKey,
        fileName: modeFileName(mode.name),
      });
    }

    for (const coll of Object.values(allCollections)) {
      if (coll.parentVariableCollectionId === collId && !coll.remote) {
        walk(coll.id, `${brandKey}/${coll.name}`);
      }
    }
  }

  walk(baseCollectionId, baseBrandKey);
  return contexts;
}

// Fallback: find the base collection most likely to be the typography collection.
// Prefers the one whose name contains "typography" (case-insensitive);
// if no name match, picks the only base collection that has extension sub-collections.
function findTypographyBaseCollection(
  variableCollections: Record<string, LocalVariableCollection>
): string | null {
  const allCollections = variableCollections as Record<string, ExtCollection>;

  const baseCandidates = Object.values(allCollections).filter(
    (c) => !c.remote && !c.isExtension
  );

  const byName = baseCandidates.find((c) => c.name.toLowerCase().includes("typography"));
  if (byName) return byName.id;

  const withExtensions = baseCandidates.filter((c) =>
    Object.values(allCollections).some((ext) => ext.parentVariableCollectionId === c.id)
  );
  return withExtensions.length === 1 ? withExtensions[0].id : null;
}

// Build the W3C color/gradient value for a fill style. context selects which
// (collection × mode) to resolve bound colors against; pass null to use the raw
// resolved colors (no mode dimension).
function valueFromFillStyle(
  doc: FillDoc,
  context: ModeContext | null,
  variables: Record<string, LocalVariable>
): { type: string; value: TokenValue } | null {
  const fill = doc.fills?.[0];
  if (!fill) return null;

  if (fill.type === "SOLID") {
    const color = colorForContext(fill.boundVariables?.color, fill.color && rgbToHex(fill.color), context, variables);
    if (!color) return null;
    return { type: "color", value: color };
  }

  const stops = (fill.gradientStops ?? []).map((stop) => ({
    color: colorForContext(stop.boundVariables?.color, rgbToHex(stop.color), context, variables),
    position: stop.position,
  }));

  const gradientType = fill.type === "GRADIENT_RADIAL" ? "radial" : "linear";

  return {
    type: "gradient",
    value: {
      type: gradientType,
      angle: gradientAngle(fill.gradientHandlePositions ?? []),
      stops,
    },
  };
}

function valueFromTextStyleForContext(
  doc: TextDoc,
  context: ModeContext,
  variables: Record<string, LocalVariable>
): TokenValue {
  const style = doc.style;
  const bound = allBoundVariables(doc);

  const resolve = (key: string, rawValue: unknown): unknown => {
    const boundVal = bound[key];
    if (boundVal) {
      const variable = variables[resolveAlias(boundVal).id];
      if (variable) {
        return context.collection
          ? getVariableValueForMode(variable, context.modeId, context.collection, variables)
          : tokenValueFromVariable(variable, context.modeId, variables);
      }
    }
    return rawValue;
  };

  const value: Record<string, unknown> = {
    fontFamily: resolve("fontFamily", style?.fontFamily),
    fontSize: resolve("fontSize", style?.fontSize),
    fontWeight: resolve("fontWeight", style?.fontWeight),
    lineHeight: resolve("lineHeight", style?.lineHeightPx),
    letterSpacing: resolve("letterSpacing", style?.letterSpacing),
  };

  if (style?.fontStyle) value.fontStyle = style.fontStyle.toLowerCase().includes("italic") ? "italic" : "normal";
  if (style?.textCase === "UPPER") value.textTransform = "uppercase";

  return value;
}

// Resolve a color (solid fill, gradient stop, or shadow) for a given mode
// context. The color may be bound to a variable in a collection with light/dark
// (etc.) modes and optional brand extensions. Falls back to the raw hex when
// there is no context (single-file mode) or no binding.
function colorForContext(
  binding: VariableAlias | undefined,
  rawHex: string | undefined,
  context: ModeContext | null,
  variables: Record<string, LocalVariable>
): string | undefined {
  if (!context || !binding) return rawHex;

  const variable = variables[binding.id];
  if (!variable) return rawHex;

  const resolved = context.collection
    ? getVariableValueForMode(variable, context.modeId, context.collection, variables)
    : tokenValueFromVariable(variable, context.modeId, variables);
  return typeof resolved === "string" ? resolved : rawHex;
}

function isShadowOrBlur(type: string | undefined): boolean {
  return type === "DROP_SHADOW" || type === "INNER_SHADOW" || type === "LAYER_BLUR" || type === "BACKGROUND_BLUR";
}

function isBlur(type: string | undefined): boolean {
  return type === "LAYER_BLUR" || type === "BACKGROUND_BLUR";
}

// Build the W3C shadow/blur value array for an effect style. context selects
// which (collection × mode) to resolve colors against; pass null to use the raw
// resolved colors (no mode dimension). Geometry is taken as-is from the style.
function valueFromEffectStyle(
  doc: EffectDoc,
  context: ModeContext | null,
  variables: Record<string, LocalVariable>
): Record<string, unknown>[] {
  const effects = doc.effects ?? [];

  return effects
    .filter((e) => isShadowOrBlur(e.type))
    .map((effect) => {
      if (isBlur(effect.type)) {
        return { radius: effect.radius };
      }

      const color = colorForContext(effect.boundVariables?.color, effect.color && rgbToHex(effect.color), context, variables);
      return {
        offsetX: effect.offset?.x ?? 0,
        offsetY: effect.offset?.y ?? 0,
        blur: effect.radius,
        spread: effect.spread ?? 0,
        ...(color ? { color } : {}),
        ...(effect.type === "INNER_SHADOW" ? { inset: true } : {}),
      };
    });
}

function setNestedToken(root: TokensFile, namePath: string, token: Token): void {
  let obj: TokensFile = root;
  const parts = namePath.split("/");

  parts.slice(0, -1).forEach((part) => {
    const key = part.trim();
    if (!obj[key]) obj[key] = {};
    obj = obj[key] as TokensFile;
  });

  const leafKey = parts[parts.length - 1].trim();
  Object.assign(obj, { [leafKey]: token });
}

export async function tokenFilesFromStyles(
  fileId: string,
  accessToken: string,
  localVariablesResponse: GetLocalVariablesResponse
): Promise<BrandTokenFiles> {
  const { variables, variableCollections } = localVariablesResponse.meta;

  const stylesResponse = await getFileStyles(fileId, accessToken);
  const styles = stylesResponse.meta.styles;

  const byType: Record<string, Record<string, string>> = {};

  for (const style of styles) {
    const { style_type: styleType, node_id: nodeId, name } = style;
    if (styleType === "GRID") continue;
    if (!byType[styleType]) byType[styleType] = {};
    byType[styleType][nodeId] = name;
  }

  const result: BrandTokenFiles = {};

  for (const [ styleType, nodeMap ] of Object.entries(byType)) {
    const nodeIds = Object.keys(nodeMap);
    const nodesResponse = await getFileNodes(fileId, nodeIds, accessToken);

    if (styleType === "TEXT") {
      // Find the base collection: first try bound variables, then fall back to name/structure heuristics
      let baseCollectionId: string | null = null;
      for (const nodeEntry of Object.values(nodesResponse.nodes)) {
        const doc = nodeEntry.document as unknown as TextDoc;
        for (const bound of Object.values(allBoundVariables(doc))) {
          const variable = variables[resolveAlias(bound).id];
          if (variable) {
            baseCollectionId = variable.variableCollectionId;
            break;
          }
        }
        if (baseCollectionId) break;
      }
      if (!baseCollectionId) {
        baseCollectionId = findTypographyBaseCollection(variableCollections);
      }

      const contexts = baseCollectionId
        ? buildModeContexts(baseCollectionId, variableCollections, TYPOGRAPHY_BRAND_KEY)
        : [];

      for (const context of contexts) {
        if (!result[context.brandKey]) result[context.brandKey] = {};
        if (!result[context.brandKey][context.fileName]) result[context.brandKey][context.fileName] = {};

        for (const nodeEntry of Object.values(nodesResponse.nodes)) {
          const doc = nodeEntry.document as unknown as StyleDoc;
          const { name, description } = doc;
          const value = valueFromTextStyleForContext(doc, context, variables);
          const token: Token = { $type: "typography", $value: value };
          if (description) token.$description = description;
          setNestedToken(result[context.brandKey][context.fileName], name, token);
        }
      }
    } else if (styleType === "FILL") {
      // Fill styles bind their color (solid paint or gradient stops) to a
      // variable; that variable's collection (e.g. "Colors" with light/dark
      // modes) and its brand extensions define the per-mode/brand output — the
      // same walk used for typography and effects.
      // Only the first paint is serialized by valueFromFillStyle, so detect
      // colorCollectionId from that same paint (and its gradient stops).
      let colorCollectionId: string | null = null;
      for (const nodeEntry of Object.values(nodesResponse.nodes)) {
        const doc = nodeEntry.document as unknown as FillDoc;
        const fill = doc.fills?.[0];
        if (!fill) continue;
        const bindings = [ fill.boundVariables?.color, ...(fill.gradientStops ?? []).map((s) => s.boundVariables?.color) ];
        for (const binding of bindings) {
          const variable = binding ? variables[binding.id] : undefined;
          if (variable) {
            colorCollectionId = variable.variableCollectionId;
            break;
          }
        }
        if (colorCollectionId) break;
      }

      const writeColorTokens = (target: TokensFile, context: ModeContext | null): void => {
        for (const nodeEntry of Object.values(nodesResponse.nodes)) {
          const doc = nodeEntry.document as unknown as StyleDoc;
          const { name, description } = doc;
          const fillValue = valueFromFillStyle(doc, context, variables);
          if (!fillValue) continue;
          const { type, value } = fillValue;
          const token: Token = { $type: type, $value: value };
          if (description) token.$description = description;
          setNestedToken(target, name, token);
        }
      };

      const contexts = colorCollectionId
        ? buildModeContexts(colorCollectionId, variableCollections, COLOR_BRAND_KEY)
        : [];

      if (contexts.length) {
        // Color-bound fills: one file per (collection × mode), e.g. styles/color/light.json, styles/color/App/light.json
        for (const context of contexts) {
          if (!result[context.brandKey]) result[context.brandKey] = {};
          if (!result[context.brandKey][context.fileName]) result[context.brandKey][context.fileName] = {};
          writeColorTokens(result[context.brandKey][context.fileName], context);
        }
      } else {
        // No color binding: single resolved file (backward compatible)
        if (!result[STYLES_BRAND_KEY]) result[STYLES_BRAND_KEY] = {};
        result[STYLES_BRAND_KEY]["color.json"] = {};
        writeColorTokens(result[STYLES_BRAND_KEY]["color.json"], null);
      }
    } else if (styleType === "EFFECT") {
      // Effect styles bind their color to a variable; that variable's collection
      // (e.g. "Effects" with light/dark modes) and its brand extensions define
      // the per-mode/brand output — the same walk used for typography.
      let colorCollectionId: string | null = null;
      for (const nodeEntry of Object.values(nodesResponse.nodes)) {
        const doc = nodeEntry.document as unknown as EffectDoc;
        for (const effect of doc.effects ?? []) {
          const binding = effect.boundVariables?.color;
          const variable = binding ? variables[binding.id] : undefined;
          if (variable) {
            colorCollectionId = variable.variableCollectionId;
            break;
          }
        }
        if (colorCollectionId) break;
      }

      const writeEffectTokens = (target: TokensFile, context: ModeContext | null): void => {
        for (const nodeEntry of Object.values(nodesResponse.nodes)) {
          const doc = nodeEntry.document as unknown as StyleDoc;
          const { name, description } = doc;
          const values = valueFromEffectStyle(doc, context, variables);
          if (!values.length) continue;
          const firstRelevant = doc.effects?.find((e) => isShadowOrBlur(e.type));
          const tokenType = isBlur(firstRelevant?.type) ? "blur" : "shadow";
          const token: Token = { $type: tokenType, $value: values };
          if (description) token.$description = description;
          setNestedToken(target, name, token);
        }
      };

      const contexts = colorCollectionId
        ? buildModeContexts(colorCollectionId, variableCollections, EFFECT_BRAND_KEY)
        : [];

      if (contexts.length) {
        // Color-bound effects: one file per (collection × mode), e.g. styles/effect/lightMode.json, styles/effect/App/lightMode.json
        for (const context of contexts) {
          if (!result[context.brandKey]) result[context.brandKey] = {};
          if (!result[context.brandKey][context.fileName]) result[context.brandKey][context.fileName] = {};
          writeEffectTokens(result[context.brandKey][context.fileName], context);
        }
      } else {
        // No color binding: single resolved file (backward compatible)
        if (!result[STYLES_BRAND_KEY]) result[STYLES_BRAND_KEY] = {};
        result[STYLES_BRAND_KEY]["effect.json"] = {};
        writeEffectTokens(result[STYLES_BRAND_KEY]["effect.json"], null);
      }
    }
  }

  return result;
}
