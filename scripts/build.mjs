#!/usr/bin/env node
// Builds platform files from tokens/tokens.json with Style Dictionary v4.
//   build/css/tokens.css   — CSS custom properties (aliases kept as var(--…))
//   build/dart/tokens.dart — Flutter constants (AppColors, AppSpacing, AppRadius)
import StyleDictionary from 'style-dictionary';
import { formattedVariables, fileHeader } from 'style-dictionary/utils';

const COLLECTION_CLASS = { color: 'AppColors', spacing: 'AppSpacing', radius: 'AppRadius' };

function dartIdentifier(segments) {
  const camel = segments
    .map((s, i) => s.split('-').map((p, j) => (i === 0 && j === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(''))
    .join('');
  return /^[0-9]/.test(camel) ? `v${camel}` : camel;
}

function dartValue(token) {
  if (token.$type === 'color') {
    const h = token.$value.replace('#', '').toUpperCase();
    const argb = h.length === 8 ? h.slice(6) + h.slice(0, 6) : 'FF' + h;
    return `Color(0x${argb})`;
  }
  if (token.$type === 'dimension') return String(parseFloat(token.$value));
  return JSON.stringify(token.$value);
}

StyleDictionary.registerFormat({
  name: 'dart/flutter-tokens',
  format: async ({ dictionary, file }) => {
    const header = await fileHeader({ file, commentStyle: 'short' });
    const groups = {};
    for (const t of dictionary.allTokens) (groups[t.path[0]] ??= []).push(t);
    let out = `${header.trimEnd()}\n\n// ignore_for_file: constant_identifier_names\nimport 'package:flutter/painting.dart';\n`;
    for (const [collection, list] of Object.entries(groups)) {
      const cls = COLLECTION_CLASS[collection] ?? 'App' + collection.charAt(0).toUpperCase() + collection.slice(1);
      const type = list[0].$type === 'color' ? 'Color' : 'double';
      out += `\nabstract final class ${cls} {\n`;
      for (const t of list) out += `  static const ${type} ${dartIdentifier(t.path.slice(1))} = ${dartValue(t)};\n`;
      out += `}\n`;
    }
    return out;
  },
});

StyleDictionary.registerFormat({
  name: 'css/variables-with-header',
  format: async ({ dictionary, file, options }) => {
    const header = await fileHeader({ file });
    return `${header}:root {\n${formattedVariables({ format: 'css', dictionary, outputReferences: options.outputReferences, usesDtcg: true })}\n}\n`;
  },
});

const sd = new StyleDictionary({
  source: ['tokens/tokens.json'],
  usesDtcg: true,
  log: { verbosity: 'default' },
  platforms: {
    css: {
      transforms: ['name/kebab', 'color/css'],
      buildPath: 'build/css/',
      files: [{ destination: 'tokens.css', format: 'css/variables-with-header', options: { outputReferences: true } }],
    },
    dart: {
      transforms: ['name/camel'],
      buildPath: 'build/dart/',
      files: [{ destination: 'tokens.dart', format: 'dart/flutter-tokens' }],
    },
  },
});

await sd.cleanAllPlatforms();
await sd.buildAllPlatforms();
console.log('\n✓ CSS Generated  → build/css/tokens.css');
console.log('✓ Dart Generated → build/dart/tokens.dart\n');
