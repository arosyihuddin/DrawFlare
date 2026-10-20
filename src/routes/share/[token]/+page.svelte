<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ExcalidrawEditor from '$lib/ExcalidrawEditor.svelte';
  let scene = $state<unknown>({ elements: [], appState: {}, files: {} });
  let boardId = $state('');
  let title = $state('Shared drawing');
  let permission = $state<'view' | 'edit'>('view');
  let status = $state('Loading shared drawing…');
  let ready = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let remoteApplyTimer: ReturnType<typeof setTimeout> | undefined;
  let latestScene: unknown;
  let saving = false;
  let queued = false;
  let revision = $state(1);
  let conflict = $state(false);
  let collaborationSocket: WebSocket | null = null;
  let applyRemoteScene: ((value: unknown) => void) | null = null;
  let remoteApplying = false;
  const token = $derived(page.params.token ?? '');
  async function load() {
    const response = await fetch('/api/share/' + encodeURIComponent(token));
    const data = await response.json() as { id?: string; title?: string; scene?: unknown; revision?: number; permission?: 'view' | 'edit'; error?: string };
    if (!response.ok) throw new Error(data.error || 'Could not load shared drawing');
    boardId = data.id!;
    title = data.title || 'Shared drawing';
    scene = data.scene;
    latestScene = data.scene;
    revision = data.revision ?? 1;
    permission = data.permission || 'view';
    ready = true;
    status = permission === 'edit' ? 'Shared · Can edit' : 'Shared · View only';
    connectCollaboration();
  }
  function connectCollaboration() {
    collaborationSocket?.close();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(scheme + '//' + location.host + '/api/share/' + encodeURIComponent(token) + '/realtime');
    collaborationSocket = socket;
    socket.addEventListener('open', () => {
      status = 'Connected · live collaboration';
      socket.send(JSON.stringify({ type: 'request-scene' }));
    });
    socket.addEventListener('message', (event) => {
      let message: { type?: string; scene?: unknown; revision?: number };
      try { message = JSON.parse(String(event.data)) as typeof message; } catch { return; }
      if (message.type === 'request-scene') {
        if (permission === 'edit' && scene && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'scene', scene: latestScene ?? scene, revision }));
        }
        return;
      }
      if (message.type !== 'scene' || !message.scene || typeof message.scene !== 'object') return;
      remoteApplying = true;
      scene = message.scene;
      latestScene = message.scene;
      if (typeof message.revision === 'number') revision = message.revision;
      applyRemoteScene?.(message.scene);
      if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
      remoteApplyTimer = setTimeout(() => { remoteApplying = false; }, 250);
    });
    socket.addEventListener('close', () => {
      if (collaborationSocket === socket) status = 'Realtime disconnected · reconnect required';
    });
    socket.addEventListener('error', () => {
      if (collaborationSocket === socket) status = 'Realtime unavailable · autosave active';
    });
  }

  function scheduleSave(value: unknown) {
    latestScene = value;
    if (remoteApplying || permission !== 'edit' || conflict) return;
    if (collaborationSocket?.readyState === WebSocket.OPEN) {
      try { collaborationSocket.send(JSON.stringify({ type: 'scene', scene: value })); } catch { /* Autosave remains available. */ }
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), 900);
  }

  async function save() {
    if (saving || conflict) { queued = true; return; }
    saving = true;
    status = 'Saving…';
    try {
      const response = await fetch('/api/share/' + encodeURIComponent(token), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: latestScene, expectedRevision: revision }) });
      const result = await response.json().catch(() => ({})) as { revision?: number; error?: string };
      if (!response.ok) {
        if (response.status === 409) conflict = true;
        throw new Error(result.error || (response.status === 403 ? 'This link is view-only' : 'Save failed'));
      }
      if (typeof result.revision === 'number') {
        revision = result.revision;
        if (collaborationSocket?.readyState === WebSocket.OPEN) {
          try { collaborationSocket.send(JSON.stringify({ type: 'scene', scene: latestScene, revision })); } catch { /* The saved scene remains durable. */ }
        }
      }
      status = 'Saved';
    } catch (e) { status = e instanceof Error ? e.message : 'Save failed'; }
    finally { saving = false; if (queued && !conflict) { queued = false; void save(); } else if (conflict) queued = false; }
  }


  onMount(() => {
    void load().catch((e) => { status = e instanceof Error ? e.message : 'Could not open share link'; });
    return () => {
      if (timer) clearTimeout(timer);
      if (remoteApplyTimer) clearTimeout(remoteApplyTimer);
      collaborationSocket?.close();
    };
  });
</script>
<svelte:head><title>{title} · DrawFlare</title></svelte:head>
<main>
  {#if ready}
    <ExcalidrawEditor initialData={scene} onSave={scheduleSave} onRemoteScene={(apply) => { applyRemoteScene = apply; }} viewOnly={permission === 'view'} />
  {:else}<div class="loading" role="status">{status}</div>{/if}
  {#if conflict}<div class="conflict-overlay" role="presentation"><dialog open class="conflict-dialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-description"><h2 id="conflict-title">Drawing changed</h2><p id="conflict-description">This drawing was updated elsewhere. Reload to get the latest version before continuing.</p><button onclick={() => location.reload()}>Reload drawing</button></dialog></div>{/if}
</main>
<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  main { position: relative; width: 100%; height: 100dvh; }
  .loading { display: grid; height: 100%; place-items: center; color: #64748b; font: 14px system-ui, sans-serif; }
  .conflict-overlay { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(15 23 42 / .48); overflow-y: auto; }
  .conflict-dialog { box-sizing: border-box; width: min(100%, 420px); margin: auto; padding: 24px; border: 2px solid #1e293b; border-radius: 18px; background: #fff; color: #1e293b; box-shadow: 5px 5px 0 rgb(30 41 59 / .9); font: 14px system-ui, sans-serif; }
  .conflict-dialog h2 { margin: 0 0 8px; font: 400 25px 'Excalifont', sans-serif; letter-spacing: -.025em; }
  .conflict-dialog p { margin: 0 0 20px; color: #64748b; line-height: 1.5; }
  .conflict-dialog button { width: 100%; min-height: 40px; border: 2px solid #1e293b; border-radius: 12px; padding: 9px 14px; background: #4f46e5; color: #fff; box-shadow: 2px 2px 0 rgb(30 41 59 / .9); font: inherit; font-weight: 700; cursor: pointer; }
  .conflict-dialog button:hover { background: #6366f1; }
  .conflict-dialog button:focus-visible { outline: 3px solid rgb(99 102 241 / .4); outline-offset: 3px; }
  :global(html[data-theme="dark"]) .conflict-dialog { border-color: #525252; background: #171717; color: #fafafa; box-shadow: 5px 5px 0 #404040; }
  :global(html[data-theme="dark"]) .conflict-dialog p { color: #a3a3a3; }
  :global(html[data-theme="dark"]) .conflict-dialog button { border-color: #525252; box-shadow: 2px 2px 0 #404040; }
</style>