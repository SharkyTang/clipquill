// Preserve old vocabulary for explicit import, but never silently reuse it.
export function migrateTerms(storage) {
  if (storage.getItem('terms-policy-v1') === null) {
    const old = storage.getItem('terms');
    if (old && storage.getItem('terms-legacy') === null) storage.setItem('terms-legacy',old);
    storage.setItem('terms-policy-v1','explicit-per-task');
  }
  return storage.getItem('terms-legacy') || '';
}
export function activeTerms(enabled, value) { return enabled ? value.trim().slice(0,400) : ''; }
