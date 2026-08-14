/**
 * Cleans Yahoo Fantasy Sports API JSON into plain, predictable shapes.
 * See the module-level comment in the implementation plan / design spec for
 * why this exists: Yahoo's ?format=json is a naive XML->JSON conversion.
 * Three patterns, unwound bottom-up:
 *  1. A "numbered collection" ({"0": x, "1": y, "count": 2}) becomes [x, y].
 *  2. An array of objects whose combined keys never repeat is really one
 *     resource sharded across elements ([{a:1}, {b:2}] -> {a:1, b:2}).
 *  3. An array where every element has the exact same single key is a list
 *     of same-typed wrapped items -- unwrap the wrapper, keep the list
 *     ([{manager: {...}}, {manager: {...}}] -> [{...}, {...}]).
 * A residual quirk not fully solvable without live data: Yahoo sometimes
 * represents a singular sub-element as a bare object instead of a
 * one-item list. Watch for this when checking real fixtures (see the
 * implementation plan's fixture-recording task).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberedCollection(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((key) => key === "count" || /^\d+$/.test(key));
}

function canMergeAsShards(elements: unknown[]): elements is Record<string, unknown>[] {
  if (elements.length < 2) return false;
  if (!elements.every(isPlainObject)) return false;
  const allKeys = elements.flatMap((el) => Object.keys(el as Record<string, unknown>));
  return allKeys.length > 0 && new Set(allKeys).size === allKeys.length;
}

function postprocessArray(cleaned: unknown[]): unknown {
  if (canMergeAsShards(cleaned)) {
    const merged: Record<string, unknown> = {};
    for (const shard of cleaned) Object.assign(merged, shard);
    return merged;
  }
  if (cleaned.length >= 1 && cleaned.every((el) => isPlainObject(el) && Object.keys(el).length === 1)) {
    const keys = cleaned.map((el) => Object.keys(el as Record<string, unknown>)[0]);
    if (new Set(keys).size === 1) {
      const [key] = keys;
      return cleaned.map((el) => (el as Record<string, unknown>)[key]);
    }
  }
  // A single element left over after the more specific rules above didn't
  // fire is Yahoo's redundant one-item wrapper around a whole sub-resource.
  if (cleaned.length === 1 && isPlainObject(cleaned[0])) return cleaned[0];
  return cleaned;
}

export function cleanYahoo(value: unknown): unknown {
  if (Array.isArray(value)) {
    return postprocessArray(value.map(cleanYahoo));
  }
  if (isPlainObject(value)) {
    if (isNumberedCollection(value)) {
      const items = Object.keys(value)
        .filter((key) => key !== "count")
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => cleanYahoo(value[key]));
      return postprocessArray(items);
    }
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, cleanYahoo(val)]));
  }
  return value;
}
