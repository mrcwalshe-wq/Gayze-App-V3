// Test-only entry keeps the actual component and services in ONE module graph.
export { ChatRoomView } from '../../src/components/ChatRoomView';
export { subscribeToRecoveredMessages } from '../../src/services/chatSubscriptions';
export { ChatMessageProcessor, MessageBatcher } from '../../src/services/chatMessageProcessing';
export { mergeMessages } from '../../src/services/messageMerge';
export { beginChatTrace, clearChatTrace } from '../../src/services/chatTrace';
export { encryptWithConversationKey, decryptWithConversationKey } from '../../src/services/cryptoService';
export { messageBackend, row, delay } from '../chat-tests/fixtures';
