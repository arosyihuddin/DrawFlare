export function confirmAction(message: string, options: { title?: string; confirmLabel?: string; destructive?: boolean } = {}): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  window.dispatchEvent(new CustomEvent('drawflare:confirm', {
    detail: { message, title: options.title ?? 'Are you sure?', confirmLabel: options.confirmLabel ?? 'Confirm', destructive: options.destructive ?? false, resolve }
  }));
  return promise;
}
export function promptAction(message: string, options: { title?: string; confirmLabel?: string; defaultValue?: string; placeholder?: string; inputType?: 'text' | 'password'; minLength?: number } = {}): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const { promise, resolve } = Promise.withResolvers<string | null>();
  window.dispatchEvent(new CustomEvent('drawflare:prompt', {
    detail: {
      message,
      title: options.title ?? 'Enter a value',
      confirmLabel: options.confirmLabel ?? 'Save',
      defaultValue: options.defaultValue ?? '',
      placeholder: options.placeholder ?? '',
      inputType: options.inputType ?? 'text',
      minLength: options.minLength ?? 0,
      resolve
    }
  }));
  return promise;
}
