import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePayload, decodePayload, sanitizeNote, MAX_NOTE_CHARS } from '../../src/services/meetupWire.ts';
import { mergeMessages } from '../../src/services/messageMerge.ts';
import type { EncryptedMessage, VoiceNote } from '../../src/types.ts';

const audio: VoiceNote = { kind: 'audio', mime: 'audio/webm', data: 'data:audio/webm;base64,AAAA', seconds: 7 };

test('a voice message survives encode and decode, and older text is kept for old app versions', () => {
  const out = decodePayload(encodePayload('Voice message', undefined, undefined, undefined, audio), 1);
  assert.equal(out.text, 'Voice message');
  assert.deepEqual(out.note, audio);
});

test('plain text and photo payloads are unchanged', () => {
  assert.equal(encodePayload('hi'), 'hi');
  assert.equal(decodePayload('hi', 1).note, undefined);
});

test('a peer cannot smuggle a script, a wrong type, or an oversized clip through the note', () => {
  assert.equal(sanitizeNote({ kind: 'audio', data: 'data:text/html;base64,AAAA', seconds: 3 }), undefined);
  assert.equal(sanitizeNote({ kind: 'audio', data: 'javascript:alert(1)', seconds: 3 }), undefined);
  assert.equal(sanitizeNote({ kind: 'video', data: 'data:audio/webm;base64,AAAA', seconds: 3 }), undefined, 'kind must match the media type');
  assert.equal(sanitizeNote({ kind: 'audio', data: 'data:audio/webm;base64,' + 'A'.repeat(MAX_NOTE_CHARS), seconds: 3 }), undefined);
  assert.equal(sanitizeNote({ kind: 'audio', data: 'data:audio/webm;base64,AA"onerror="x', seconds: 3 }), undefined);
  assert.equal(sanitizeNote({ kind: 'audio', data: 'data:audio/webm;base64,AAAA', seconds: 9999 })?.seconds, 120);
});

test('an unsent voice message stays gone', () => {
  const base: EncryptedMessage = { id: 'm', roomId: 'r', senderKey: 'a', senderName: 'A', timestamp: 1, cipherText: 'c', nonceHex: 'n', plainText: 'Voice message', noteData: audio };
  const [unsent] = mergeMessages([base], [{ ...base, deletedForEveryone: true, noteData: undefined }]);
  assert.equal(unsent.noteData, undefined);
  assert.equal(mergeMessages([unsent], [base])[0].noteData, undefined);
});
