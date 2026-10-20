<script lang="ts">
  import { onMount } from 'svelte';
  let { id, title }: { id: string; title: string } = $props();
  let host: HTMLDivElement;
  let previewSvg = $state('');
  let failed = $state(false);

  onMount(() => {
    let cancelled = false;
    let started = false;
    let inView = false;
    let isDark = document.documentElement.dataset.theme === 'dark';
    let observer: IntersectionObserver | undefined;
    const render = async () => {
      if (started || cancelled) return;
      started = true;
      try {
        const response = await fetch('/api/drawings/' + encodeURIComponent(id));
        if (!response.ok) throw new Error('Could not load drawing preview');
        const payload = await response.json() as { scene?: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } };
        const scene = payload.scene;
        const elements = (scene?.elements ?? []).filter((element) => !(element as { isDeleted?: boolean }).isDeleted);
        if (!elements.length) { if (!cancelled) failed = true; return; }
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const svg = await exportToSvg({
          elements: elements as never,
          appState: {
            ...(scene?.appState ?? {}),
            theme: isDark ? 'dark' : 'light',
            exportWithDarkMode: isDark,
            exportBackground: false,
            viewBackgroundColor: isDark ? '#171717' : '#f8fafc'
          } as never,
          files: (scene?.files ?? {}) as never,
          exportPadding: 12,
          skipInliningFonts: true,
          reuseImages: true
        });
        if (!cancelled) {
          // Excalidraw writes its dark-mode CSS filter into the SVG `filter`
          // attribute, but that attribute only accepts SVG filter references.
          // Apply it as a CSS filter so strokes and fills adapt in thumbnails.
          if (isDark) svg.style.filter = 'invert(93%) hue-rotate(180deg)';
          else svg.style.removeProperty('filter');
          previewSvg = svg.outerHTML;
        }
      } catch {
        if (!cancelled) failed = true;
      }
    };
    const themeObserver = new MutationObserver(() => {
      const nextIsDark = document.documentElement.dataset.theme === 'dark';
      if (nextIsDark === isDark) return;
      isDark = nextIsDark;
      started = false;
      previewSvg = '';
      failed = false;
      if (inView) void render();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    if (typeof IntersectionObserver === 'undefined') {
      inView = true;
      void render();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          inView = true;
          void render();
          observer?.disconnect();
        }
      }, { rootMargin: '320px 0px' });
      observer.observe(host);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
      themeObserver.disconnect();
    };
  });
</script>

<div bind:this={host} class="preview-host" role="img" aria-label={'Preview of ' + title}>
  {#if previewSvg}
    <div class="preview-svg">{@html previewSvg}</div>
  {:else if failed}
    <svg class="placeholder" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14 5 5 5M4 20l4.5-1 10.2-10.2a2.1 2.1 0 0 0-3-3L5.5 16z"/><path d="M4 20h16"/></svg>
  {:else}
    <span class="preview-loading" aria-hidden="true">✎</span>
  {/if}
</div>

<style>
  .preview-host{display:grid;place-items:center;width:100%;height:100%;min-height:0;overflow:hidden;padding:14px}
  .preview-svg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;overflow:hidden}
  .preview-svg :global(svg){display:block;width:auto;height:auto;max-width:100%;max-height:100%;filter:drop-shadow(1px 1px 0 rgb(30 41 59 / .08))}
  .placeholder{width:60px;height:60px;padding:12px;border:2px solid #1e293b;border-radius:15px;background:#fff;color:#cbd5e1;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(2px 2px 0 rgb(30 41 59 / .2))}
  .preview-loading{display:grid;place-items:center;width:60px;height:60px;border:2px solid #1e293b;border-radius:15px;background:#fff;color:#cbd5e1;font:40px 'Excalifont',sans-serif;box-shadow:2px 2px 0 rgb(30 41 59 / .2)}
  :global(html[data-theme="dark"]) .placeholder,:global(html[data-theme="dark"]) .preview-loading{border-color:#525252;background:#262626;color:#737373;box-shadow:2px 2px 0 rgb(255 255 255 / .08);filter:none}
</style>
