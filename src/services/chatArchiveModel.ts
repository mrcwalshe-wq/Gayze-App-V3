/** Pure archive reconciliation (no network), so it can be tested. */
export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

/**
 * Reconcile the account's archive with this device. The account wins; changes made while offline (pending) are applied on top
 * and sent up, and a list archived on this device before the account kept one is sent up once.
 * Pure so it can be tested: returns the archive to show and what still has to be sent.
 */
export function reconcileArchive(server: string[], local: string[], pending: Record<string, boolean>, migrated: boolean) {
  const result = new Set(server);
  const toArchive = new Set<string>();
  const toRestore = new Set<string>();
  if (!migrated) for (const id of local) if (!result.has(id) && isUuid(id)) { result.add(id); toArchive.add(id); }
  for (const [id, archived] of Object.entries(pending)) {
    if (archived) { result.add(id); toArchive.add(id); } else { result.delete(id); toRestore.add(id); toArchive.delete(id); }
  }
  return { archived: result, toArchive: [...toArchive], toRestore: [...toRestore] };
}
