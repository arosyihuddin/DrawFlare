<script lang="ts">
  import { confirmAction, promptAction } from '$lib/confirm';
  import { onMount } from 'svelte';
  import ExcalidrawEditor from '$lib/ExcalidrawEditor.svelte';

  type HistoryEntry = { id: string; title: string; created_at: string };
  let boardId = $state('');
  let title = $state('Untitled drawing');
  let revision = $state(1);
  let scene = $state<unknown>({ elements: [], appState: {}, files: {} });
  let status = $state('Loading drawing…');
  let errorDetails = $state('');
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
      const message = error instanceof Error ? (error.stack ?? error.message) : 'Save failed: ' + String(error);
      if (message.toLowerCase().includes('changed')) conflictDetected = true;
      status = error instanceof Error ? error.message : 'Save failed';
      errorDetails = 'DrawFlare save error\n' + message;
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

  type ShareLink = { token: string; permission: 'view' | 'edit'; expires_at: string | null; created_at?: string };
  let showShare = $state(false);
  let shares = $state<ShareLink[]>([]);
  let shareLoading = $state(false);
  let shareError = $state('');
  let creatingShare = $state(false);
  let sharePermission = $state<'view' | 'edit'>('edit');
  let shareExpiry = $state('never');

  function formatExpiry(value: string | null) {
    if (!value) return 'Never expires';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : 'Expires ' + parsed.toLocaleString();
  }

  async function refreshShares() {
    if (!boardId) return;
    shareLoading = true;
    try {
      const response = await fetch('/api/drawings/' + encodeURIComponent(boardId) + '/shares');
      const data = await response.json() as ShareLink[] | { error?: string };
      if (!response.ok || !Array.isArray(data)) throw new Error((data as { error?: string }).error || 'Could not load share links');
      shares = data;
    } catch (error) {
      shareError = error instanceof Error ? error.message : 'Could not load share links';
    } finally {
      shareLoading = false;
    }
  }

  async function openShare() {
    if (!boardId) return;
    showShare = true;
    shares = [];
    shareError = '';
    await refreshShares();
  }

  async function createShare() {
    if (!boardId || creatingShare) return;
    creatingShare = true;
    shareError = '';
    try {
      const body: { permission: 'view' | 'edit'; expiresInDays?: number } = { permission: sharePermission };
      if (shareExpiry !== 'never') body.expiresInDays = Number(shareExpiry);
      const response = await fetch('/api/drawings/' + encodeURIComponent(boardId) + '/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not create share link');
      let copied = false;
      try { await navigator.clipboard.writeText(data.url); copied = true; } catch { /* The link stays visible in the list below. */ }
      await refreshShares();
      shareError = copied ? 'Link created and copied to clipboard.' : 'Link created. Copy it from the list below.';
    } catch (error) {
      shareError = error instanceof Error ? error.message : 'Could not create share link';
    } finally {
      creatingShare = false;
    }
  }

  async function copyShare(share: ShareLink) {
    const url = location.origin + '/share/' + share.token;
    try { await navigator.clipboard.writeText(url); shareError = 'Link copied to clipboard.'; }
    catch { await promptAction('Copy the link below if clipboard access is unavailable.', { title: 'Copy share link', defaultValue: url, confirmLabel: 'Done' }); }
  }

  async function revokeShare(share: ShareLink) {
    if (!await confirmAction('Revoke this ' + share.permission + ' link? Anyone using it will lose access.', { title: 'Revoke share link', confirmLabel: 'Revoke link', destructive: true })) return;
    const response = await fetch('/api/drawings/' + encodeURIComponent(boardId) + '/shares', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: share.token }) });
    if (response.ok) shares = shares.filter((item) => item.token !== share.token);
    else shareError = 'Could not revoke share link';
  }

  onMount(() => {
    try {
      const raw = localStorage.getItem('excali_preferences');
      if (raw) {
        const prefs = JSON.parse(raw) as { autosaveSeconds?: number };
        if (typeof prefs.autosaveSeconds === 'number') autosaveDelay = Math.min(3, Math.max(1, prefs.autosaveSeconds));
      }
    } catch { /* Browser preferences are optional. */ }
    void (async () => {
      try {
        const id = new URLSearchParams(location.search).get('id');
        if (id) await openDrawing(id, new URLSearchParams(location.search).get('new') === '1');
        else await createDrawing();
      } catch (error) {
        status = error instanceof Error ? error.message : 'Failed to open drawing';
        errorDetails = 'DrawFlare open error\n' + (error instanceof Error ? (error.stack ?? error.message) : String(error));
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
        <ExcalidrawEditor bind:title onTitleCommit={renameDrawing} onHistory={() => void loadHistory()} onShare={() => void openShare()} initialData={scene} onSave={saveScene} onRemoteScene={(apply) => { applyRemoteScene = apply; if (pendingRemoteScene) { apply(pendingRemoteScene); pendingRemoteScene = null; } }} />
      {/key}
    {:else}
      <div class="loading" role="status">{status}</div>
    {/if}
  </div>
  {#if errorDetails}
    <div class="error-overlay" role="presentation">
      <div class="error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="save-error-title" tabindex="-1">
        <div class="error-heading">
          <div class="error-icon">!</div>
          <div>
            <h2 id="save-error-title">Drawing error detected</h2>
            <p>The operation failed. Copy the diagnostic details and send them to your AI agent.</p>
          </div>
        </div>
        <pre class="error-details">{errorDetails}</pre>
        <div class="error-actions">
          <button type="button" class="error-copy" onclick={() => void navigator.clipboard.writeText(errorDetails)}>Copy Error</button>
          <button type="button" class="error-close" onclick={() => { errorDetails = ''; }}>Close</button>
        </div>
      </div>
    </div>
  {/if}

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

  {#if showShare}
    <div class="history-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) showShare = false; }}>
      <div class="history-panel" role="dialog" aria-modal="true" aria-labelledby="share-title" tabindex="-1">
        <div class="history-heading"><div><h2 id="share-title">Share drawing</h2><p>{title}</p></div><button class="top-button" onclick={() => showShare = false} aria-label="Close share">×</button></div>
        <div class="share-form">
          <label for="share-permission">Access</label>
          <select id="share-permission" bind:value={sharePermission}><option value="edit">Can edit</option><option value="view">Can view</option></select>
          <label for="share-expiry">Expiration</label>
          <select id="share-expiry" bind:value={shareExpiry}><option value="never">Never</option><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
          <button class="primary" onclick={() => void createShare()} disabled={creatingShare}>{creatingShare ? 'Creating…' : 'Create share link'}</button>
        </div>
        {#if shareError}<p class="share-message" role="status">{shareError}</p>{/if}
        {#if collaborators > 1}<p class="share-message">{collaborators} people are in this drawing right now.</p>{/if}
        <h3 class="share-heading">Active links</h3>
        {#if shareLoading}<p class="history-empty">Loading links…</p>
        {:else if shares.length === 0}<p class="history-empty">No active links. Create one above.</p>
        {:else}
          <div class="share-list">
            {#each shares as share (share.token)}
              <div class="share-item">
                <div class="share-meta"><strong>{share.permission === 'edit' ? 'Can edit' : 'Can view'}</strong><small>{formatExpiry(share.expires_at)}</small><input readonly value={location.origin + '/share/' + share.token} aria-label="Share URL" onclick={(event) => (event.currentTarget as HTMLInputElement).select()} /></div>
                <div class="share-actions"><button class="top-button" onclick={() => void copyShare(share)}>Copy</button><button class="top-button danger" onclick={() => void revokeShare(share)}>Revoke</button></div>
              </div>
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
  .editor-area { position: absolute; inset: 0; min-height: 0; }
  .top-button { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; padding: 5px 9px; border: 1px solid #dbe1ea; border-radius: 8px; background: #fff; color: #334155; font: 600 12px system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .top-button:hover { background: #eef2ff; border-color: #818cf8; }
  .history-overlay { position: absolute; z-index: 30; inset: 0; display: grid; justify-items: end; background: rgb(0 0 0 / .4); }
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
  .share-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; padding: 14px; border: 2px solid #e2e8f0; border-radius: 14px; background: #fff; }
  .share-form label { align-self: end; color: #475569; font: 800 12px system-ui, sans-serif; }
  .share-form select { padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #1e293b; font: 600 13px system-ui, sans-serif; }
  .share-form .primary { grid-column: 1 / -1; min-height: 36px; margin-top: 4px; border: 2px solid #1e293b; border-radius: 10px; background: #6965db; color: #fff; font: 700 13px system-ui, sans-serif; cursor: pointer; }
  .share-form .primary:disabled { opacity: .6; cursor: wait; }
  .share-message { margin: 10px 0 0; color: #475569; font: 12px/1.5 system-ui, sans-serif; }
  .share-heading { margin: 22px 0 10px; color: #0f172a; font: 700 13px system-ui, sans-serif; }
  .share-list { display: grid; gap: 10px; }
  .share-item { display: grid; gap: 10px; padding: 12px; border: 2px solid #1e293b; border-radius: 12px; background: #fff; box-shadow: 2px 2px 0 #1e293b; }
  .share-meta { display: grid; gap: 5px; min-width: 0; }
  .share-meta strong { color: #1e293b; font: 700 13px system-ui, sans-serif; }
  .share-meta small { color: #64748b; font: 11px system-ui, sans-serif; }
  .share-meta input { box-sizing: border-box; width: 100%; padding: 7px 8px; border: 1px solid #cbd5e1; border-radius: 8px; background: #f8fafc; color: #334155; font: 12px ui-monospace, monospace; }
  .share-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .top-button.danger { color: #be123c; border-color: #fecdd3; }
  .top-button.danger:hover { background: #fff1f2; border-color: #fb7185; }
  :global(html[data-theme="dark"]) .history-overlay { background: rgb(0 0 0 / .6); }
  :global(html[data-theme="dark"]) .history-panel { background: #171717; border-left-color: #404040; box-shadow: -4px 0 0 #00000040; }
  :global(html[data-theme="dark"]) .history-heading p, :global(html[data-theme="dark"]) .history-empty, :global(html[data-theme="dark"]) .share-message, :global(html[data-theme="dark"]) .share-meta small { color: #a3a3a3; }
  :global(html[data-theme="dark"]) .history-item, :global(html[data-theme="dark"]) .share-item { background: #262626; border-color: #525252; box-shadow: 2px 2px 0 #404040; }
  :global(html[data-theme="dark"]) .history-item strong, :global(html[data-theme="dark"]) .share-meta strong, :global(html[data-theme="dark"]) .share-heading { color: #f5f5f5; }
  :global(html[data-theme="dark"]) .top-button { background: #262626; border-color: #525252; color: #e5e5e5; }
  :global(html[data-theme="dark"]) .top-button:hover { background: #333; border-color: #6366f1; }
  :global(html[data-theme="dark"]) .top-button.danger { color: #fda4af; }
  :global(html[data-theme="dark"]) .share-form .primary { border-color: #525252; }
  @media (max-width: 520px) { .history-panel { padding: 18px; } .share-form { grid-template-columns: 1fr; } }
  .error-overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / .55); }
  .error-dialog { box-sizing: border-box; width: min(560px, 100%); max-height: min(80dvh, 680px); overflow: auto; padding: 22px; border: 1px solid #fecaca; border-radius: 14px; background: #fff; color: #1f2937; box-shadow: 0 24px 80px rgb(0 0 0 / .25); }
  .error-heading { display: flex; align-items: flex-start; gap: 12px; }
  .error-icon { display: grid; flex: 0 0 32px; width: 32px; height: 32px; place-items: center; border-radius: 50%; background: #fee2e2; color: #b91c1c; font: 800 20px system-ui, sans-serif; }
  .error-heading h2 { margin: 0; font: 700 18px/1.35 system-ui, sans-serif; }
  .error-heading p { margin: 5px 0 0; color: #64748b; font: 13px/1.5 system-ui, sans-serif; }
  .error-details { box-sizing: border-box; max-height: 42dvh; overflow: auto; margin: 18px 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; color: #334155; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 ui-monospace, monospace; }
  .error-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .error-actions button { min-height: 36px; padding: 7px 13px; border-radius: 8px; font: 600 13px system-ui, sans-serif; cursor: pointer; }
  .error-copy { border: 1px solid #4f46e5; background: #4f46e5; color: white; }
  .error-close { border: 1px solid #cbd5e1; background: white; color: #334155; }
  :global(html[data-theme="dark"]) .error-dialog { border-color: #7f1d1d; background: #171717; color: #f5f5f5; }
  :global(html[data-theme="dark"]) .error-heading p { color: #a3a3a3; }
  :global(html[data-theme="dark"]) .error-details { border-color: #404040; background: #262626; color: #e5e5e5; }
  :global(html[data-theme="dark"]) .error-close { border-color: #525252; background: #262626; color: #e5e5e5; }
</style>
