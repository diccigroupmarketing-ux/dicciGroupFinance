import { useSyncExternalStore } from "react";

// Guna untuk gate render client-only (contoh createPortal) tanpa setState dalam
// effect. useSyncExternalStore pulang server snapshot (false) semasa SSR dan
// paint hydration pertama supaya padan HTML server, lepas tu tukar ke client
// snapshot (true), jadi tiada hydration mismatch dan tiada flash.
const subscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
