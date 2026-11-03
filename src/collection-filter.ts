import type { LocalVariableCollection } from "@figma/rest-api-spec";

import type { FigmaCollectionExtras } from "./types.ts";

type ExtCollection = LocalVariableCollection & FigmaCollectionExtras;

/** Invalid user input (e.g. a misspelled collection name), as opposed to an internal bug. */
export class InputError extends Error {
  override name = "InputError";
}

/** Returns true when the collection should be part of the output. */
export type CollectionPredicate = (collectionId: string) => boolean;

const allowAll: CollectionPredicate = () => true;

// Exact, case-insensitive match; "*" matches any run of characters (e.g. "* WEB", "DN *").
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

// One line per hierarchy level (top level first, e.g. Colors → brand → brand app/web).
// Brand extensions share names across parents (e.g. Colors/DN WEB, Typography/DN WEB), so each name is listed once per level.
function formatByLevel(collections: ExtCollection[], chains: Map<string, string[]>): string {
  const levels: Set<string>[] = [];
  for (const collection of collections) {
    const depth = (chains.get(collection.id)?.length ?? 1) - 1;
    (levels[depth] ??= new Set()).add(collection.name);
  }
  return levels
    .map((names, depth) => `  ${depth === 0 ? "Top level" : `Level ${depth + 1}`}: ${[ ...names ].sort().join(", ")}`)
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the opt-in filter for `includedCollections`.
 *
 * With no patterns, every collection is allowed. Otherwise:
 * - base (non-extension) collections are always allowed, since included
 *   extensions build on them;
 * - an extension collection is allowed when it, one of its ancestors, or one
 *   of its descendants matches a pattern. Sibling brands are dropped.
 *
 * Throws when a pattern matches no collection, so a typo cannot silently
 * produce base-only output.
 */
export function createIncludedCollectionsFilter(
  variableCollections: Record<string, LocalVariableCollection>,
  includedCollections: Iterable<string>
): CollectionPredicate {
  const patterns = [ ...includedCollections ].map((p) => p.trim()).filter((p) => p.length > 0);
  if (patterns.length === 0) return allowAll;

  const collections = Object.values(variableCollections as Record<string, ExtCollection>).filter((c) => !c.remote);
  const regexps = patterns.map(patternToRegExp);

  const byId = new Map(collections.map((c) => [ c.id, c ]));

  // Chain from each collection up to its top-level collection: [self, parent, …, root].
  const chains = new Map<string, string[]>();
  for (const collection of collections) {
    const chain: string[] = [];
    let current: ExtCollection | undefined = collection;
    while (current && !chain.includes(current.id)) {
      chain.push(current.id);
      current = current.parentVariableCollectionId ? byId.get(current.parentVariableCollectionId) : undefined;
    }
    chains.set(collection.id, chain);
  }

  const unmatched = patterns.filter((_, i) => !collections.some((c) => regexps[i].test(c.name)));
  if (unmatched.length > 0) {
    throw new InputError(
      `includedCollections: no collection matches ${unmatched.map((p) => `"${p}"`).join(", ")}. Available collections:\n${formatByLevel(collections, chains)}`
    );
  }

  const matched = new Set(collections.filter((c) => regexps.some((r) => r.test(c.name))).map((c) => c.id));

  // A collection is allowed if it is matched or is an ancestor/descendant of a matched one.
  const allowed = new Set<string>();
  for (const collection of collections) {
    const chain = chains.get(collection.id) ?? [];
    if (matched.has(collection.id)) {
      // Matched: allow it and all its ancestors.
      for (const id of chain) allowed.add(id);
    } else if (chain.some((id) => matched.has(id))) {
      // Descendant of a matched collection.
      allowed.add(collection.id);
    }
  }

  return (collectionId) => {
    const collection = byId.get(collectionId);
    if (!collection) return true;
    if (!collection.isExtension) return true;
    return allowed.has(collectionId);
  };
}
