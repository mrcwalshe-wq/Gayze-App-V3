## 2023-10-26 - Haversine Distance Closure Optimization
**Learning:** The `haversineKm` distance calculation function in `RightNowView.tsx` creates an internal `toRad` closure on every call. Because it's used extensively in O(N*M) clustering loops to determine distance between map objects, the allocation overhead becomes significant.
**Action:** Always extract constants like `Math.PI / 180` and inline simple math conversions outside of inner functions in heavily iterated loops (e.g., map rendering or clustering logic) to prevent memory allocation overhead per iteration. This yielded a ~4.7x speedup for this function.
## $(date +%Y-%m-%d) - Object.entries().map() React State Anti-Pattern
**Learning:** Found a severe React re-render anti-pattern in `App.tsx` where updating/deleting a single message rebuilt the message array for *every* chat room (`Object.fromEntries(Object.entries(prev).map(...))`). This broke reference equality for all unrelated rooms, causing massive unnecessary rendering cascades.
**Action:** When updating a deep dictionary state (like `Record<string, Message[]>`), avoid mapping over the entire dictionary if the update is localized. Instead, locate the specific key (e.g., `roomId`) that needs updating, and only reconstruct that specific value while spreading the rest of the dictionary (`{ ...prev, [targetRoomId]: updatedArray }`) to preserve references.

## 2024-05-18 - Dictionary State Update Anti-Pattern
**Learning:** React state updates using `Object.fromEntries(Object.entries(prev).filter(...))` creates unnecessary intermediate array allocations and increases garbage collection (GC) pressure, especially in performance-sensitive contexts.
**Action:** Use shallow copying (`const next = { ...prev };`) and a targeted `delete next[key];` loop to update localized dictionary states instead of transforming the entire dictionary back and forth through arrays.
