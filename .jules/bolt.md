## 2024-10-29 - Avoid Object.fromEntries(filter) for dictionary updates
**Learning:** `Object.fromEntries(Object.entries(previous).filter(...))` is used in `App.tsx` for updating states acting as dictionaries (like `messages`). This pattern creates multiple intermediate arrays, allocating unnecessary memory and causing GC pressure during every state update.
**Action:** When working with dictionary-style objects, shallow copy the dictionary and explicitly `delete` the targeted keys. This is $O(N)$ for copying and $O(K)$ for deletion, instead of the multiple array allocations.
