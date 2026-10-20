<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import ExcalidrawEditor from '$lib/ExcalidrawEditor.svelte';
  type SharedDrawing = { id: string; title: string; revision: number; updated_at: string; scene: unknown };
  type SharedCollection = { id: string; name: string };
  const token = $derived(page.params.token ?? '');
  let collection = $state<SharedCollection | null>(null);
  let drawings = $state<SharedDrawing[]>([]);
  let selectedId = $state('');
  let permission = $state<'view' | 'edit'>('view');
  let loading = $state(true);
  let error = $state('');
  let status = $state('Loading shared collection…');
  let editorKey = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latestScene: unknown;
  let saving = false;
  let queued = false;
  let conflict = $state(false);
  const selected = $derived(drawings.find((drawing) => drawing.id === selectedId) ?? null);

  async function load() {
    loading = true; error = '';
    try {
      const response = await fetch('/api/collection-share/' + encodeURIComponent(token));
      const data = await response.json() as { collection?: SharedCollection; permission?: 'view' | 'edit'; drawings?: SharedDrawing[]; error?: string };
      if (!response.ok || !data.collection || !Array.isArray(data.drawings)) throw new Error(data.error || 'Could not load collection');
      collection = data.collection; permission = data.permission ?? 'view'; drawings = data.drawings;
      selectedId = drawings[0]?.id ?? ''; latestScene = drawings[0]?.scene;
      editorKey += 1; status = permission === 'edit' ? 'Shared collection · Can edit' : 'Shared collection · View only';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load collection'; status = error; }
    finally { loading = false; }
  }

  function selectDrawing(drawing: SharedDrawing) {
    if (timer) { clearTimeout(timer); timer = undefined; void save(); }
    selectedId = drawing.id; latestScene = drawing.scene; conflict = false; editorKey += 1;
    status = permission === 'edit' ? 'Ready to edit' : 'View only';
  }

  function scheduleSave(scene: unknown) {
    latestScene = scene;
    if (permission !== 'edit' || conflict || !selected) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void save(), 900);
    status = 'Unsaved changes…';
  }

  async function save() {
    const drawing = selected;
    if (!drawing || permission !== 'edit' || conflict) return;
    if (saving) { queued = true; return; }
    saving = true; status = 'Saving…';
    try {
      const response = await fetch('/api/collection-share/' + encodeURIComponent(token), {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ drawingId: drawing.id, scene: latestScene, expectedRevision: drawing.revision })
      });
      const data = await response.json().catch(() => ({})) as { revision?: number; error?: string; conflict?: boolean };
      if (!response.ok) { if (response.status === 409) conflict = true; throw new Error(data.error || 'Save failed'); }
      if (typeof data.revision === 'number') drawing.revision = data.revision;
      status = 'Saved';
    } catch (e) { status = e instanceof Error ? e.message : 'Save failed'; }
    finally { saving = false; if (queued && !conflict) { queued = false; void save(); } else if (conflict) queued = false; }
  }

  onMount(() => { void load(); return () => { if (timer) clearTimeout(timer); }; });
</script>

<svelte:head><title>{collection?.name ?? 'Shared collection'} · DrawFlare</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="shared-workspace">
  <header class="topbar"><a href="/" class="brand">DrawFlare</a><div class="collection-title"><strong>{collection?.name ?? 'Shared collection'}</strong><small>{permission === 'edit' ? 'Can edit' : 'View only'}</small></div><span class="status" aria-live="polite">{status}</span></header>
  {#if loading}<div class="state">{status}</div>
  {:else if error}<div class="state error">{error}</div>
  {:else}
    <aside class="drawing-list"><h2>Drawings <span>{drawings.length}</span></h2>
      {#if drawings.length === 0}<p class="empty">This collection has no drawings.</p>{/if}
      {#each drawings as drawing (drawing.id)}
        <button class:active={selectedId === drawing.id} class="drawing-item" onclick={() => selectDrawing(drawing)}><span class="drawing-thumb">▱</span><span><strong>{drawing.title}</strong><small>Updated {new Date(drawing.updated_at).toLocaleString()}</small></span></button>
      {/each}
    </aside>
    <section class="canvas">
      {#if selected}
        {#key editorKey}<ExcalidrawEditor initialData={selected.scene} viewOnly={permission !== 'edit'} onSave={scheduleSave} />{/key}
      {:else}<div class="state">Select a drawing to view it.</div>{/if}
      {#if conflict}<div class="conflict"><span>This drawing changed elsewhere. Reload to get the latest version.</span><button onclick={() => location.reload()}>Reload</button></div>{/if}
    </section>
  {/if}
</main>

<style>
  :global(html),:global(body){margin:0;width:100%;height:100%;overflow:hidden;background:#f8fafc;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  .shared-workspace{display:grid;grid-template-columns:280px minmax(0,1fr);grid-template-rows:64px minmax(0,1fr);width:100%;height:100dvh}
  .topbar{grid-column:1/-1;display:flex;align-items:center;gap:18px;padding:0 18px;border-bottom:1px solid #e2e8f0;background:white}
  .brand{color:#4f46e5;font:400 24px Excalifont,sans-serif;text-decoration:none}.collection-title{display:grid;gap:3px}.collection-title strong{font-size:13px}.collection-title small,.status{color:#64748b;font-size:11px}.status{margin-left:auto}
  .drawing-list{min-width:0;overflow:auto;padding:18px 12px;border-right:1px solid #e2e8f0;background:#fff}.drawing-list h2{display:flex;justify-content:space-between;align-items:center;margin:0 4px 14px;font-size:13px}.drawing-list h2 span{color:#64748b;font-size:11px}
  .drawing-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid transparent;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.drawing-item:hover{background:#f8fafc}.drawing-item.active{border-color:#c7d2fe;background:#eef2ff}.drawing-thumb{display:grid;place-items:center;flex:0 0 38px;height:34px;border:1px solid #e2e8f0;border-radius:7px;background:white;color:#6366f1;font-size:22px}.drawing-item>span:last-child{display:grid;gap:5px;min-width:0}.drawing-item strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.drawing-item small{color:#64748b;font-size:10px}
  .canvas{position:relative;min-width:0;min-height:0}.canvas :global(.editor){height:100%}.state{display:grid;place-items:center;grid-column:1/-1;color:#64748b;font-size:13px}.error{color:#be123c}.empty{padding:10px;color:#64748b;font-size:12px}.conflict{position:absolute;z-index:20;bottom:20px;left:50%;display:flex;align-items:center;gap:12px;transform:translateX(-50%);padding:10px 12px;border:1px solid #fecaca;border-radius:10px;background:#fff1f2;color:#9f1239;font-size:12px;box-shadow:0 4px 18px #0f172a1a}.conflict button{padding:6px 9px;border:0;border-radius:7px;background:#be123c;color:white;font-size:11px;cursor:pointer}
  @media(max-width:650px){.shared-workspace{grid-template-columns:1fr;grid-template-rows:58px auto minmax(0,1fr)}.topbar{gap:10px;padding:0 10px}.brand{font-size:20px}.collection-title strong{max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{max-width:100px;text-align:right}.drawing-list{display:flex;gap:6px;overflow-x:auto;overflow-y:hidden;padding:8px;border-right:0;border-bottom:1px solid #e2e8f0}.drawing-list h2{display:none}.drawing-item{flex:0 0 180px;padding:6px}.drawing-thumb{flex-basis:30px;height:30px}.drawing-item small{display:none}}
</style>
