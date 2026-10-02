import type { EncryptedMessage } from '../types';

/** Stable server IDs cover REST catch-up, Realtime echoes and write responses.
 * A stale snapshot must never resurrect a burned message or downgrade plaintext. */
export function mergeMessage(existing: EncryptedMessage[], incoming: EncryptedMessage): EncryptedMessage[] {
  return mergeMessages(existing, [incoming]);
}

export function mergeMessages(existing: EncryptedMessage[], incomingRows: EncryptedMessage[]): EncryptedMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]));
  let changed = false;
  for (const incoming of incomingRows) {
    const old = byId.get(incoming.id);
    const burned = Boolean(old?.isBurned || incoming.isBurned);
    const sameCipher = old?.cipherText === incoming.cipherText && old?.nonceHex === incoming.nonceHex;
    const message = {
      ...old, ...incoming,
      plainText: burned ? '' : incoming.plainText === '[Encrypted message]' && old?.plainText && sameCipher
        ? old.plainText : incoming.plainText,
      isBurned: burned,
      mediaUrl: burned ? undefined : incoming.mediaUrl ?? (sameCipher ? old?.mediaUrl : undefined),
    };
    if (!old || Object.keys(message).some((key) => old[key as keyof EncryptedMessage] !== message[key as keyof EncryptedMessage])) {
      byId.set(incoming.id, message);
      changed = true;
    }
  }
  return changed ? [...byId.values()].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)) : existing;
}
