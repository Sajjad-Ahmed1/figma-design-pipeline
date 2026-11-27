// Figma main thread: reads local Variables and turns them into a W3C DTCG
// tokens file. Everything that talks to GitHub lives in ui.html.
//
// Mapping
//   Collection "Color"    → top-level group "color"   (collection name, lowercased)
//   Variable "brand/primary" → color.brand.primary   ("/" = nesting, names kept as typed)
//   COLOR  → { "$type": "color",     "$value": "#RRGGBB[AA]" }
//   FLOAT  → { "$type": "dimension", "$value": "16px" }
//   Alias  → "$value": "{color.neutral.0}"
// Only the default mode of each collection is exported.

figma.showUI(__html__, { width: 380, height: 640, themeColors: false });

const SETTINGS_KEY = 'design-pipeline-settings';

function hex2(n) {
  return Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
}
function toHex({ r, g, b, a = 1 }) {
  return '#' + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(a) : '');
}
function pathOf(collectionName, variableName) {
  return [collectionName.trim().toLowerCase(), ...variableName.split('/').map((s) => s.trim())];
}

async function exportTokens() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const tree = {};
  const warnings = [];
  const counts = {};
  const pathCache = new Map();

  async function aliasPath(id) {
    if (pathCache.has(id)) return pathCache.get(id);
    const v = await figma.variables.getVariableByIdAsync(id);
    if (!v) return null;
    const c = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    const p = pathOf(c ? c.name : 'unknown', v.name).join('.');
    pathCache.set(id, p);
    return p;
  }

  for (const collection of collections) {
    const groupKey = collection.name.trim().toLowerCase();
    if (collection.modes.length > 1) {
      warnings.push(`"${collection.name}" has ${collection.modes.length} modes — exporting "${collection.modes[0].name}" only.`);
    }
    const modeId = collection.defaultModeId;
    for (const id of collection.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      const raw = v.valuesByMode[modeId];
      let type;
      let value;
      if (raw && typeof raw === 'object' && raw.type === 'VARIABLE_ALIAS') {
        const target = await aliasPath(raw.id);
        if (!target) { warnings.push(`${v.name}: alias target not found — skipped.`); continue; }
        type = v.resolvedType === 'COLOR' ? 'color' : 'dimension';
        value = `{${target}}`;
      } else if (v.resolvedType === 'COLOR') {
        type = 'color';
        value = toHex(raw);
      } else if (v.resolvedType === 'FLOAT') {
        type = 'dimension';
        value = `${Math.round(raw * 100) / 100}px`;
      } else {
        warnings.push(`${collection.name}/${v.name}: ${v.resolvedType} variables are not exported.`);
        continue;
      }

      const segments = pathOf(collection.name, v.name);
      let node = tree;
      let conflict = false;
      for (const seg of segments.slice(0, -1)) {
        node[seg] = node[seg] || {};
        if ('$value' in node[seg]) { conflict = true; break; }
        node = node[seg];
      }
      const leaf = segments[segments.length - 1];
      if (conflict || (node[leaf] && !('$value' in node[leaf]))) {
        warnings.push(`${segments.join('/')}: name clashes with a group of the same name — skipped.`);
        continue;
      }
      node[leaf] = {
        $type: type,
        $value: value,
        $extensions: { 'com.figma': { variableId: v.id } },
      };
      counts[groupKey] = (counts[groupKey] || 0) + 1;
    }
  }

  return {
    json: JSON.stringify(tree, null, 2) + '\n',
    counts,
    warnings,
    fileName: figma.root.name,
    user: figma.currentUser ? figma.currentUser.name : 'a designer',
  };
}

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'load-settings') {
      const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) || {};
      figma.ui.postMessage({ type: 'settings', settings });
    } else if (msg.type === 'save-settings') {
      await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings);
      figma.ui.postMessage({ type: 'settings-saved' });
    } else if (msg.type === 'clear-settings') {
      await figma.clientStorage.deleteAsync(SETTINGS_KEY);
      figma.ui.postMessage({ type: 'settings', settings: {} });
    } else if (msg.type === 'export') {
      const result = await exportTokens();
      figma.ui.postMessage({ type: 'exported', result });
    } else if (msg.type === 'notify') {
      figma.notify(msg.text, { error: !!msg.error });
    }
  } catch (e) {
    figma.ui.postMessage({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};
