const D1_SCENE_LIMIT = 512_000;
const MAX_SCENE_BYTES = 25 * 1024 * 1024;
const R2_POINTER = '__excalidraw_r2_scene_v1';

type SceneEnv = App.Platform['env'];
type StoredScene = { stored: string; byteLength: number; inR2: boolean };

function isR2Pointer(value: unknown): value is Record<typeof R2_POINTER, string> {
  return typeof value === 'object' && value !== null && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>)[R2_POINTER] === 'string';
}

export async function readScene(serialized: string, boardId: string, env: SceneEnv | undefined): Promise<unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); }
  catch { throw new Error('Saved whiteboard data is corrupted'); }
  if (!isR2Pointer(parsed)) return parsed;
  const key = parsed[R2_POINTER];
  if (!key.startsWith('scenes/' + boardId + '/')) throw new Error('Invalid R2 scene reference');
  const bucket = env?.FILES;
  if (!bucket) throw new Error('This whiteboard uses R2 storage, but the FILES binding is not configured');
  const object = await bucket.get(key);
  if (!object) throw new Error('Whiteboard scene is missing from R2 storage');
  return JSON.parse(await object.text()) as unknown;
}

export async function storeScene(scene: unknown, boardId: string, env: SceneEnv | undefined): Promise<StoredScene> {
  const serialized = JSON.stringify(scene);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_SCENE_BYTES) throw new Error('Scene exceeds the 25 MB limit');
  if (byteLength <= D1_SCENE_LIMIT) return { stored: serialized, byteLength, inR2: false };
  const bucket = env?.FILES;
  if (!bucket) {
    if (byteLength > 1_000_000) throw new Error('Scene exceeds 1 MB and R2 is not configured. Configure the FILES binding to save larger drawings.');
    return { stored: serialized, byteLength, inR2: false };
  }
  const key = 'scenes/' + boardId + '/' + crypto.randomUUID() + '.json';
  await bucket.put(key, serialized, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return { stored: JSON.stringify({ [R2_POINTER]: key }), byteLength, inR2: true };
}

export async function removeSceneAsset(serialized: string, boardId: string, env: SceneEnv | undefined) {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { return; }
  if (!isR2Pointer(parsed)) return;
  const key = parsed[R2_POINTER];
  if (!key.startsWith('scenes/' + boardId + '/')) return;
  await env?.FILES?.delete(key);
}
