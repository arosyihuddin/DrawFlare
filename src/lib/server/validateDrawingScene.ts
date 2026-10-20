import { generateKeyBetween } from 'fractional-indexing';

export function validateDrawingScene(scene: unknown): string | null {
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
    return 'scene must be a JSON object';
  }

  const value = scene as Record<string, unknown>;
  if (!Array.isArray(value.elements)) {
    return 'scene.elements must be an array';
  }

  const seenIndexes = new Set<string>();
  for (let i = 0; i < value.elements.length; i += 1) {
    const element = value.elements[i];
    if (!element || typeof element !== 'object' || Array.isArray(element)) {
      return `scene.elements[${i}] must be an object`;
    }

    const record = element as Record<string, unknown>;
    if (typeof record.type !== 'string' || !record.type) {
      return `scene.elements[${i}].type must be a non-empty string`;
    }
    if (typeof record.index !== 'string' || !record.index) {
      return `scene.elements[${i}].index must be a valid Excalidraw fractional index string`;
    }

    try {
      // This validates the key using the same fractional-indexing algorithm
      // used to generate valid order keys. A key like "z" throws here.
      generateKeyBetween(record.index, null);
    } catch {
      return `scene.elements[${i}].index is invalid: "${record.index}"`;
    }

    if (seenIndexes.has(record.index)) {
      return `scene.elements[${i}].index duplicates another element's index: "${record.index}"`;
    }
    seenIndexes.add(record.index);
  }

  if (value.appState !== undefined && (!value.appState || typeof value.appState !== 'object' || Array.isArray(value.appState))) {
    return 'scene.appState must be an object when provided';
  }
  if (value.files !== undefined && (!value.files || typeof value.files !== 'object' || Array.isArray(value.files))) {
    return 'scene.files must be an object when provided';
  }

  return null;
}
