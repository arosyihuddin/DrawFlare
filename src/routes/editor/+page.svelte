<script lang="ts">
  import { confirmAction } from '$lib/confirm';
  import { onMount } from 'svelte';
  import ExcalidrawEditor from '$lib/ExcalidrawEditor.svelte';

  type HistoryEntry = { id: string; title: string; created_at: string };
  let boardId = $state('');
  let title = $state('Untitled drawing');
  let revision = $state(1);
  let scene = $state<unknown>({ elements: [], appState: {}, files: {} });
  let editorAutoHide = $state(false);
  let status = $state('Loading drawing…');
  let ready = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveInFlight = false;
  let autosaveDelay = 1;
  let collaborationSocket: WebSocket | null = null;
  let applyRemoteScene: ((value: unknown) => void) | null = null;
  let pendingRemoteScene: unknown = null;
  let remoteApplying = false;
  let collaborators = $state(1);
  let localChannel: BroadcastChannel | null = null;

  function applyPreferencesToNewScene(value: unknown) {
    const base = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const appState = base.appState && typeof base.appState === 'object' ? { ...(base.appState as Record<string, unknown>) } : {};
    try {
      const raw = localStorage.getItem('excali_preferences');
      if (raw) {
        const prefs = JSON.parse(raw) as { theme?: string; background?: string; gridSize?: number; autosaveSeconds?: number };
        if (prefs.theme === 'light' || prefs.theme === 'dark') appState.theme = prefs.theme;
        else if (prefs.theme === 'system') appState.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        if (typeof prefs.background === 'string' && /^#[0-9a-f]{6}$/i.test(prefs.background)) appState.viewBackgroundColor = prefs.background;
        if (typeof prefs.gridSize === 'number') appState.gridSize = prefs.gridSize || null;
        if (typeof prefs.autosaveSeconds === 'number') autosaveDelay = Math.min(3, Math.max(1, prefs.autosaveSeconds));
      }
    } catch { /* Invalid browser preferences should not block creating a drawing. */ }
    return { ...base, appState };
  }
  let saveAgain = false;
  let conflictDetected = $state(false);
  let editorKey = $state(0);
  let showHistory = $state(false);
  let historyLoading = $state(false);
  let historyError = $state('');
  let historyEntries = $state<HistoryEntry[]>([]);
  let restoringId = $state('');

  async function saveScene(value: unknown) {
    scene = value;
    if (!remoteApplying) { try { localChannel?.postMessage({ type: 'scene', scene: value, revision }); } catch { /* BroadcastChannel is an optional local fallback. */ } }
    if (!remoteApplying && collaborationSocket?.readyState === WebSocket.OPEN) {
      try { collaborationSocket.send(JSON.stringify({ type: 'scene', scene: value })); } catch { /* Reconnect will resume collaboration. */ }
    }
    if (!ready || !boardId || conflictDetected) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void persistScene(), autosaveDelay * 1000);
  }

  async function persistScene() {
    if (!ready || !boardId) return;
    if (saveInFlight) { saveAgain = true; return; }
    saveInFlight = true;
    status = 'Saving…';
    try {
      const response = await fetch('/api/drawings/' + encodeURIComponent(boardId), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scene, title, expectedRevision: revision })
      });
      const result = await response.json().catch(() => ({})) as { revision?: number; error?: string };
      if (!response.ok) throw new Error(result.error || 'Save failed (' + response.status + ')');
      if (typeof result.revision === 'number') revision = result.revision;
      try { localChannel?.postMessage({ type: 'scene', scene, revision }); } catch { /* Optional local synchronization. */ }
      if (collaborationSocket?.readyState === WebSocket.OPEN) { try { collaborationSocket.send(JSON.stringify({ type: 'scene', scene, revision })); } catch { /* Realtime is best effort; the save is already durable. */ } }
      status = 'Saved';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Save failed';
      if (message.toLowerCase().includes('changed')) conflictDetected = true;
      status = message;
    } finally {
      saveInFlight = false;
      if (saveAgain && !conflictDetected) { saveAgain = false; void persistScene(); }
      else if (conflictDetected) saveAgain = false;
    }
  }

  function connectCollaboration(id: string) {
    collaborationSocket?.close();
    localChannel?.close();
    localChannel = null;
    try {
      localChannel = new BroadcastChannel('drawflare-drawing:' + id);
      localChannel.onmessage = (event: MessageEvent) => {
        const message = event.data as { type?: string; scene?: unknown; revision?: number };
        if (message?.type === 'scene' && message.scene && typeof message.scene === 'object') {
          remoteApplying = true; scene = message.scene; pendingRemoteScene = message.scene; if (typeof message.revision === 'number') revision = message.revision; applyRemoteScene?.(message.scene); status = 'Live · changes synced in this browser';
          setTimeout(() => { remoteApplying = false; }, 100);
        }
        if (message?.type === 'request-scene') localChannel?.postMessage({ type: 'scene', scene, revision });
      };
    } catch { localChannel = null; }
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(scheme + '//' + location.host + '/api/drawings/' + encodeURIComponent(id) + '/realtime');
    collaborationSocket = socket;
    socket.addEventListener('open', () => { status = 'Connected · live collaboration'; socket.send(JSON.stringify({ type: 'request-scene' })); });
    localChannel?.postMessage({ type: 'request-scene' });
    socket.addEventListener('message', (event) => {
      let message: { type?: string; scene?: unknown; count?: number; revision?: number };
      try { message = JSON.parse(String(event.data)) as typeof message; } catch { return; }
      if (message.type === 'presence' && typeof message.count === 'number') collaborators = message.count;
      if (message.type === 'scene' && message.scene && typeof message.scene === 'object') {
        remoteApplying = true; scene = message.scene; pendingRemoteScene = message.scene; if (typeof message.revision === 'number') revision = message.revision; applyRemoteScene?.(message.scene);
        status = 'Live · changes synced';
        setTimeout(() => { remoteApplying = false; }, 100);
      }
      if (message.type === 'request-scene' && scene) socket.send(JSON.stringify({ type: 'scene', scene, revision }));
    });
    socket.addEventListener('close', () => { if (collaborationSocket === socket) { status = 'Same-browser sync · autosave active'; collaborators = 1; } });
    socket.addEventListener('error', () => { status = 'Same-browser sync available · remote realtime unavailable'; });
  }

  async function openDrawing(id: string, applyPreferences = false) {
    const response = await fetch('/api/drawings/' + encodeURIComponent(id));
    if (!response.ok) throw new Error(response.status === 404 ? 'Drawing not found' : 'Could not load drawing');
    const data = await response.json() as { id: string; title?: string; scene: unknown; revision?: number };
    boardId = data.id;
    title = data.title || 'Untitled drawing';
    revision = data.revision ?? 1;
    scene = applyPreferences ? applyPreferencesToNewScene(data.scene) : data.scene;
    if (applyPreferences) history.replaceState({}, '', '/editor?id=' + encodeURIComponent(boardId));
    ready = true;
    status = 'Ready';
    connectCollaboration(id);
  }

  async function createDrawing() {
    const response = await fetch('/api/drawings', {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (!response.ok) throw new Error('Could not create drawing');
    const data = await response.json() as { id: string; title?: string; scene: unknown; revision?: number };
    boardId = data.id;
    title = data.title || 'Untitled drawing';
    revision = data.revision ?? 1;
    scene = applyPreferencesToNewScene(data.scene);
    history.replaceState({}, '', '/editor?id=' + encodeURIComponent(boardId));
    ready = true;
    status = 'Ready';
    connectCollaboration(boardId);
  }

  async function loadHistory() {
    if (!boardId) return;
    showHistory = true;
    historyLoading = true;
    historyError = '';
    try {
      const response = await fetch('/api/drawings/' + encodeURIComponent(boardId) + '/history');
      const data = await response.json() as HistoryEntry[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load history');
      historyEntries = data;
    } catch (error) {
      historyError = error instanceof Error ? error.message : 'Could not load history';
    } finally {
      historyLoading = false;
    }
  }

  async function restoreHistory(entry: HistoryEntry) {
    if (!await confirmAction('Restore this version? The current drawing will be replaced.', { title: 'Restore version', confirmLabel: 'Restore version', destructive: true })) return;
    restoringId = entry.id;
    historyError = '';
    try {
      const response = await fetch('/api/drawings/' + encodeURIComponent(boardId) + '/history', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ historyId: entry.id, expectedRevision: revision })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; revision?: number };
      if (!response.ok) throw new Error(result.error || 'Could not restore version');
      const current = await fetch('/api/drawings/' + encodeURIComponent(boardId));
      if (!current.ok) throw new Error('Restored drawing, but could not reload it');
      const data = await current.json() as { title?: string; scene: unknown; revision?: number };
      title = data.title || entry.title;
      scene = data.scene;
      revision = data.revision ?? result.revision ?? revision + 1;
      editorKey += 1;
      status = 'Version restored';
      showHistory = false;
      conflictDetected = false;
    } catch (error) {
      historyError = error instanceof Error ? error.message : 'Could not restore version';
    } finally {
      restoringId = '';
    }
  }

  function renameDrawing() {
    if (saveTimer) clearTimeout(saveTimer);
    void persistScene();
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem('excali_preferences');
      if (raw) {
        const prefs = JSON.parse(raw) as { autosaveSeconds?: number; editorAutoHide?: boolean };
        if (typeof prefs.autosaveSeconds === 'number') autosaveDelay = Math.min(3, Math.max(1, prefs.autosaveSeconds));
        editorAutoHide = prefs.editorAutoHide === true;
      }
    } catch { /* Browser preferences are optional. */ }
    void (async () => {
      try {
        const id = new URLSearchParams(location.search).get('id');
        if (id) await openDrawing(id, new URLSearchParams(location.search).get('new') === '1');
        else await createDrawing();
      } catch (error) {
        status = error instanceof Error ? error.message : 'Failed to open drawing';
      }
    })();
    return () => { if (saveTimer) clearTimeout(saveTimer); collaborationSocket?.close(); localChannel?.close(); };
  });
</script>

<svelte:head>
  <title>{title} · DrawFlare</title>
  <meta name="description" content="Draw and collaborate with DrawFlare on Cloudflare Workers." />
</svelte:head>

<main>
  <div class="editor-area">
    {#if ready}
      {#key editorKey}
        <ExcalidrawEditor initialData={scene} onSave={saveScene} onRemoteScene={(apply) => { applyRemoteScene = apply; if (pendingRemoteScene) { apply(pendingRemoteScene); pendingRemoteScene = null; } }} />
      {/key}
    {:else}
      <div class="loading" role="status">{status}</div>
    {/if}
  </div>
  <div class="editor-topbar" class:autohide={editorAutoHide}>
    <a href="/" class="back" aria-label="Back to dashboard">←</a>
    <input aria-label="Drawing title" maxlength="160" bind:value={title} onblur={renameDrawing} onkeydown={(event) => { if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur(); }} />
    <button class="top-button" onclick={() => void loadHistory()}>History</button>
  </div>

  {#if showHistory}
    <div class="history-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showHistory = false; }}>
      <div class="history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title" tabindex="-1">
        <div class="history-heading"><div><h2 id="history-title">Version history</h2><p>Snapshots are created automatically every five minutes when the scene is small enough to store in D1.</p></div><button class="top-button" onclick={() => showHistory = false} aria-label="Close history">×</button></div>
        {#if historyLoading}<p class="history-empty">Loading versions…</p>
        {:else if historyError}<p class="history-error" role="alert">{historyError}</p>
        {:else if historyEntries.length === 0}<p class="history-empty">No saved versions yet. Keep editing; a snapshot is created after the drawing has been unchanged for at least five minutes between saves.</p>
        {:else}
          <div class="history-list">
            {#each historyEntries as entry (entry.id)}
              <article class="history-item"><div><strong>{entry.title}</strong><small>{new Date(entry.created_at + (entry.created_at.endsWith('Z') ? '' : 'Z')).toLocaleString()}</small></div><button class="top-button" disabled={!!restoringId} onclick={() => void restoreHistory(entry)}>{restoringId === entry.id ? 'Restoring…' : 'Restore'}</button></article>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</main>

<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  :global(body) { background: #fff; }
  main { position: relative; width: 100%; height: 100dvh; }
  .loading { display: grid; height: 100%; place-items: center; color: #64748b; font: 14px system-ui, sans-serif; }
  .editor-area { position: absolute; inset: 56px 0 0; min-height: 0; }
  .editor-topbar { position: absolute; z-index: 10; inset: 0 0 auto; box-sizing: border-box; height: 56px; display: flex; align-items: center; gap: 7px; padding: 8px 12px; border-bottom: 1px solid #dbe1ea; background: #fff; }
  .editor-topbar.autohide { opacity: .14; transform: translateY(-72%); transition: opacity .18s ease, transform .18s ease; }
  .editor-topbar.autohide:hover, .editor-topbar.autohide:focus-within { opacity: 1; transform: translateY(0); }
  .back, .top-button { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; padding: 5px 9px; border: 1px solid #dbe1ea; border-radius: 8px; background: #fff; color: #334155; font: 600 12px system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .editor-topbar input { width: min(260px, 42vw); min-width: 80px; border: 1px solid transparent; border-radius: 7px; padding: 7px 8px; outline: none; color: #1e293b; background: transparent; font: 600 13px system-ui, sans-serif; }
  .editor-topbar input:focus { border-color: #a5b4fc; background: #fff; }
  .top-button:hover, .back:hover { background: #eef2ff; border-color: #818cf8; }
  .history-overlay { position: absolute; z-index: 30; inset: 0; display: grid; justify-items: end; background: #0f172a55; }
  .history-panel { box-sizing: border-box; width: min(440px, 100%); height: 100%; overflow: auto; padding: 24px; border-left: 2px solid #1e293b; background: #f8fafc; box-shadow: -4px 0 0 #1e293b25; }
  .history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 24px; }
  .history-heading h2 { margin: 0 0 7px; color: #0f172a; font: 400 28px 'Excalifont', system-ui, sans-serif; }
  .history-heading p, .history-empty { color: #64748b; font: 13px/1.55 system-ui, sans-serif; }
  .history-list { display: grid; gap: 10px; }
  .history-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 2px solid #1e293b; border-radius: 12px; background: white; box-shadow: 2px 2px 0 #1e293b; }
  .history-item div { display: grid; gap: 5px; min-width: 0; }
  .history-item strong { overflow-wrap: anywhere; color: #1e293b; font: 700 13px system-ui, sans-serif; }
  .history-item small { color: #64748b; font: 11px system-ui, sans-serif; }
  .history-item button:disabled { opacity: .6; cursor: wait; }
  .history-error { padding: 10px; border: 1px solid #fecdd3; border-radius: 8px; background: #fff1f2; color: #9f1239; font: 13px system-ui, sans-serif; }
  @media (max-width: 520px) { .editor-topbar { padding: 8px; } .editor-topbar input { width: 25vw; } .history-panel { padding: 18px; } }
</style>
