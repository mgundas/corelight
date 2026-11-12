/** Native controls keep their own keyboard behavior while overlays are open. */
export function isUiKey(e: KeyboardEvent): boolean {
  if (!(e.target instanceof Element)) return false;
  if (e.target.closest('input, select, textarea, [contenteditable="true"]')) return true;
  return Boolean(e.target.closest('button, summary')) &&
    (['Space', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code));
}
