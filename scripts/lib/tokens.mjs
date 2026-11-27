// Shared helpers for reading W3C DTCG design-token files.
import { readFileSync } from 'node:fs';

export const ALIAS_RE = /^\{([^{}]+)\}$/;
export const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const DIMENSION_RE = /^(-?\d+(?:\.\d+)?)px$/;
export const NAME_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Walk a DTCG tree and return a flat list of tokens.
 * A token is any object that has a "$value" key. Groups may define "$type"
 * that their children inherit.
 */
export function flatten(tree, path = [], inheritedType) {
  const out = [];
  if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) return out;
  const groupType = tree.$type ?? inheritedType;
  if ('$value' in tree) {
    out.push({ path: path.join('.'), segments: path, type: groupType, value: tree.$value, raw: tree });
    return out;
  }
  for (const [key, child] of Object.entries(tree)) {
    if (key.startsWith('$')) continue;
    out.push(...flatten(child, [...path, key], groupType));
  }
  return out;
}

/** Resolve an alias chain. Returns { value } or { error }. */
export function resolve(byPath, path, seen = []) {
  if (seen.includes(path)) return { error: `circular alias: ${[...seen, path].join(' → ')}` };
  const token = byPath.get(path);
  if (!token) return { error: `alias target "${path}" does not exist` };
  const m = typeof token.value === 'string' && token.value.match(ALIAS_RE);
  if (m) return resolve(byPath, m[1], [...seen, path]);
  return { value: token.value, type: token.type };
}

// ---- WCAG 2.x contrast -------------------------------------------------------
function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrastRatio(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
