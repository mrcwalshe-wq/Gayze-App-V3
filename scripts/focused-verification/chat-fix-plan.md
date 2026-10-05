# Chat fix plan

This file records the requested chat changes before implementation.

- Restore historical encrypted-message key recovery on reopen without generating replacement conversation keys.
- Ensure profile avatars are resolved and cached by stable user ID, never display name or array position.
- Add Delete Chat (delete for me) with confirmation, local state removal, realtime cleanup, unread cleanup, and notification-route protection.
- Add regression coverage for reopen/decrypt, distinct avatars, and delete/reload persistence.
