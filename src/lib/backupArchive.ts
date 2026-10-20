import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export type BackupCollection = { id?: unknown; name?: unknown };
export type BackupDrawing = { id?: unknown; title?: unknown; scene?: unknown; collectionId?: unknown; isFavorite?: unknown; deleted?: unknown };
export type WorkspaceBackup = { format: 'drawflare-backup'; version: 1; exportedAt?: string; collections: BackupCollection[]; drawings: BackupDrawing[] };

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(strFromU8(bytes)); } catch { throw new Error('Could not parse ' + label + ' as JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must contain a JSON object.');
  return value as Record<string, unknown>;
}

function safePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some((part) => part === '..' || part === '.');
}

export function createDrawFlareArchive(payload: WorkspaceBackup): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const exportedAt = new Date().toISOString();
  const usedFolders = new Set<string>();
  const unorganizedFolder = 'Unorganized';
  usedFolders.add(unorganizedFolder.toLowerCase());
  const collectionFolder = new Map<string, string>();
  for (const collection of payload.collections) {
    if (typeof collection.id !== 'string' || typeof collection.name !== 'string') continue;
    const base = collection.name.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'Collection';
    let folder = base; let suffix = 2;
    while (usedFolders.has(folder.toLowerCase())) folder = base + ' (' + suffix++ + ')';
    usedFolders.add(folder.toLowerCase());
    collectionFolder.set(collection.id, folder);
  }
  const hasTrashDrawings = payload.drawings.some((drawing) => drawing.deleted === true);
  let trashFolder = '';
  if (hasTrashDrawings) {
    const base = 'Trash'; let suffix = 2; trashFolder = base;
    while (usedFolders.has(trashFolder.toLowerCase())) trashFolder = base + ' (' + suffix++ + ')';
    usedFolders.add(trashFolder.toLowerCase());
    collectionFolder.set('trash', trashFolder);
  }
  const drawings: Record<string, unknown>[] = [];
  for (const drawing of payload.drawings) {
    if (typeof drawing.id !== 'string' || typeof drawing.title !== 'string' || !drawing.scene || typeof drawing.scene !== 'object') continue;
    const scene = drawing.scene as Record<string, unknown>;
    const elements = Array.isArray(scene.elements) ? scene.elements : [];
    const appState = scene.appState && typeof scene.appState === 'object' ? scene.appState : {};
    const embeddedFiles = scene.files && typeof scene.files === 'object' ? scene.files : {};
    const sourceCollectionId = typeof drawing.collectionId === 'string' ? drawing.collectionId : null;
    const deleted = drawing.deleted === true;
    const collectionId = deleted ? 'trash' : sourceCollectionId;
    const folder = deleted ? trashFolder : collectionId ? collectionFolder.get(collectionId) ?? unorganizedFolder : unorganizedFolder;
    const title = drawing.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || 'Untitled';
    const filePath = folder + '/' + title + '__' + drawing.id.slice(0, 8) + '.excalidraw';
    files[filePath] = strToU8(JSON.stringify({ type: 'excalidraw', version: 2, source: 'DrawFlare', elements, appState, files: embeddedFiles, drawflare: { drawingId: drawing.id, collectionId, exportedAt } }));
    drawings.push({ id: drawing.id, name: drawing.title, filePath, collectionId, isFavorite: drawing.isFavorite === true, deleted });
  }
  const manifestCollections = payload.collections.filter((item) => typeof item.id === 'string' && typeof item.name === 'string').map((item) => ({ id: item.id as string, name: item.name as string, folder: collectionFolder.get(item.id as string) ?? unorganizedFolder }));
  if (hasTrashDrawings && !manifestCollections.some((item) => item.id === 'trash')) manifestCollections.push({ id: 'trash', name: 'Trash', folder: trashFolder });
  files['drawflare.manifest.json'] = strToU8(JSON.stringify({
    format: 'drawflare', formatVersion: 1, exportedAt, drawflareBackendVersion: 'Cloudflare Worker adaptation',
    unorganizedFolder, collections: manifestCollections,
    drawings
  }, null, 2));
  files['README.txt'] = strToU8('DrawFlare Backup (.drawflare)\n\nContains a versioned manifest and drawing files.\nFormatVersion: 1\nExportedAt: ' + exportedAt + '\n');
  return zipSync(files, { level: 6 });
}

export function readDrawFlareArchive(bytes: Uint8Array): WorkspaceBackup {
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Archive exceeds the 50 MB import limit.');
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('Invalid .drawflare archive. Choose a valid DrawFlare backup.'); }
  const names = Object.keys(files);
  if (names.length > 6000) throw new Error('Archive contains too many files.');
  const totalSize = names.reduce((sum, name) => sum + files[name].byteLength, 0);
  if (totalSize > 100 * 1024 * 1024) throw new Error('Expanded archive exceeds the 100 MB safety limit.');
  const manifestBytes = files['drawflare.manifest.json'];
  if (!manifestBytes) throw new Error('Backup is missing drawflare.manifest.json.');
  const manifest = parseJson(manifestBytes, 'Backup manifest');
  if (manifest.format !== 'drawflare' || manifest.formatVersion !== 1 || !Array.isArray(manifest.collections) || !Array.isArray(manifest.drawings)) throw new Error('Unsupported DrawFlare backup format.');
  const manifestCollections = manifest.collections as Record<string, unknown>[];
  const trashCollectionIds = new Set(manifestCollections.filter((item) => item.id === 'trash' || (typeof item.name === 'string' && item.name.trim().toLowerCase() === 'trash')).map((item) => item.id).filter((id): id is string => typeof id === 'string'));
  const collections = manifestCollections.map((item) => {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Backup contains an invalid collection.');
    return { id: item.id, name: item.name };
  }).filter((item) => !trashCollectionIds.has(item.id));
  const drawings = (manifest.drawings as Record<string, unknown>[]).map((item) => {
    if (typeof item.id !== 'string' || typeof item.name !== 'string' || !safePath(item.filePath)) throw new Error('Backup contains an invalid drawing path.');
    const drawingBytes = files[item.filePath];
    if (!drawingBytes) throw new Error('Backup drawing file is missing: ' + item.filePath);
    const source = parseJson(drawingBytes, item.filePath);
    const scene = { elements: Array.isArray(source.elements) ? source.elements : [], appState: source.appState && typeof source.appState === 'object' ? source.appState : {}, files: source.files && typeof source.files === 'object' ? source.files : {} };
    const sourceCollectionId = typeof item.collectionId === 'string' ? item.collectionId : null;
    const deleted = item.deleted === true || (sourceCollectionId !== null && trashCollectionIds.has(sourceCollectionId));
    return { id: item.id, title: item.name, collectionId: sourceCollectionId && !trashCollectionIds.has(sourceCollectionId) ? sourceCollectionId : null, isFavorite: item.isFavorite === true, deleted, scene };
  });
  if (collections.length > 500 || drawings.length > 5000) throw new Error('Backup exceeds the import limit (500 collections, 5,000 drawings).');
  return { format: 'drawflare-backup', version: 1, exportedAt: typeof manifest.exportedAt === 'string' ? manifest.exportedAt : undefined, collections, drawings };
}

export function readLegacyZip(bytes: Uint8Array): { name: string; scene: Record<string, unknown> }[] {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error('Invalid ZIP archive.'); }
  const names = Object.keys(files);
  if (names.length > 6000 || names.reduce((sum, name) => sum + files[name].byteLength, 0) > 100 * 1024 * 1024) throw new Error('ZIP archive exceeds import safety limits.');
  const result: { name: string; scene: Record<string, unknown> }[] = [];
  for (const path of names) {
    if (!/\.(excalidraw|json)$/i.test(path) || !safePath(path) || path === 'drawflare.manifest.json') continue;
    try {
      const data = parseJson(files[path], path);
      const nested = data.scene && typeof data.scene === 'object' && !Array.isArray(data.scene) ? data.scene as Record<string, unknown> : data;
      if (Array.isArray(nested.elements)) result.push({ name: path.split('/').pop()!.replace(/\.(excalidraw|json)$/i, '').slice(0, 160) || 'Imported drawing', scene: { elements: nested.elements, appState: nested.appState && typeof nested.appState === 'object' ? nested.appState : {}, files: nested.files && typeof nested.files === 'object' ? nested.files : {} } });
    } catch { /* Ignore unrelated JSON files in legacy ZIP archives. */ }
  }
  if (result.length === 0) throw new Error('ZIP contains no supported .excalidraw or scene JSON files.');
  if (result.length > 5000) throw new Error('ZIP contains too many drawings.');
  return result;
}
