import { describe, expect, test } from 'bun:test';
import { generateNKeysBetween } from 'fractional-indexing';
import { validateDrawingScene } from '../src/lib/server/validateDrawingScene.ts';

describe('validateDrawingScene', () => {
  test('accepts scenes with valid unique fractional indexes', () => {
    const indexes = generateNKeysBetween(null, null, 3);
    const scene = {
      elements: indexes.map((index, i) => ({ id: `element-${i}`, type: 'rectangle', index })),
      appState: {},
      files: {},
    };

    expect(validateDrawingScene(scene)).toBeNull();
  });

  test('rejects the malformed index that caused the browser error', () => {
    expect(validateDrawingScene({
      elements: [{ id: 'broken', type: 'rectangle', index: 'z' }],
    })).toBe('scene.elements[0].index is invalid: "z"');
  });

  test('rejects duplicate indexes', () => {
    expect(validateDrawingScene({
      elements: [
        { id: 'first', type: 'rectangle', index: 'a0' },
        { id: 'second', type: 'ellipse', index: 'a0' },
      ],
    })).toBe('scene.elements[1].index duplicates another element\'s index: "a0"');
  });

  test('rejects missing elements and malformed elements', () => {
    expect(validateDrawingScene({})).toBe('scene.elements must be an array');
    expect(validateDrawingScene({ elements: [null] })).toBe('scene.elements[0] must be an object');
    expect(validateDrawingScene({ elements: [{ type: 'rectangle' }] }))
      .toBe('scene.elements[0].index must be a valid Excalidraw fractional index string');
  });
});
