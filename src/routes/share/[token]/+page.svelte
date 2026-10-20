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
  let latestScene: unknown;
  let saving = false;
  let queued = false;
  let revision = $state(1);
  let conflict = $state(false);
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
  }

  function scheduleSave(value: unknown) {
    latestScene = value;
    if (permission !== 'edit' || conflict) return;
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
      if (typeof result.revision === 'number') revision = result.revision;
      status = 'Saved';
    } catch (e) { status = e instanceof Error ? e.message : 'Save failed'; }
    finally { saving = false; if (queued && !conflict) { queued = false; void save(); } else if (conflict) queued = false; }
  }

  onMount(() => {
    void load().catch((e) => { status = e instanceof Error ? e.message : 'Could not open share link'; });
    return () => { if (timer) clearTimeout(timer); };
  });
</script>
<svelte:head><title>{title} · DrawFlare</title></svelte:head>
<main>
  {#if ready}
    <ExcalidrawEditor initialData={scene} onSave={scheduleSave} viewOnly={permission === 'view'} />
  {:else}<div class="loading" role="status">{status}</div>{/if}
  <a class="home" href="/">DrawFlare</a>
  <div class="status" aria-live="polite"><span>{status}</span>{#if conflict}<button onclick={() => location.reload()}>Reload</button>{/if}</div>
</main>
<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; }
  main { position: relative; width: 100%; height: 100dvh; }
  .loading { display: grid; height: 100%; place-items: center; color: #64748b; font: 14px system-ui, sans-serif; }
  .status, .home { position: absolute; z-index: 10; bottom: 10px; padding: 5px 8px; border-radius: 6px; background: #ffffffd9; color: #64748b; font: 11px system-ui, sans-serif; }
  .status { right: 12px; display: flex; align-items: center; gap: 8px; } .home { left: 12px; text-decoration: none; }
  .status button { border: 0; border-radius: 4px; padding: 4px 6px; background: #6965db; color: white; font: inherit; cursor: pointer; }
</style>