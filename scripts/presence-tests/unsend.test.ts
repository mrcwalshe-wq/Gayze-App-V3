import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages } from '../../src/services/messageMerge.ts';
import type { EncryptedMessage } from '../../src/types.ts';

const base: EncryptedMessage = { id: 'm1', roomId: 'r', senderKey: 'a', senderName: 'A', timestamp: 1, cipherText: 'abc', nonceHex: 'n', plainText: 'hello', mediaUrl: 'data:image/jpeg;base64,AAAA', mediaType: 'image' };

test('an unsent message loses its text and photo, and a stale copy cannot bring them back', () => {
  const unsent = { ...base, cipherText: '', nonceHex: '', plainText: 'Message unsent', deletedForEveryone: true, mediaUrl: undefined };
  const [afterUnsend] = mergeMessages([base], [unsent]);
  assert.equal(afterUnsend.deletedForEveryone, true);
  assert.equal(afterUnsend.mediaUrl, undefined);
  assert.equal(afterUnsend.plainText, 'Message unsent');
  // A late snapshot that still has the old content (history catch-up) must not resurrect it.
  const [afterStale] = mergeMessages([afterUnsend], [base]);
  assert.equal(afterStale.deletedForEveryone, true);
  assert.equal(afterStale.mediaUrl, undefined);
  assert.equal(afterStale.plainText, 'Message unsent');
});
