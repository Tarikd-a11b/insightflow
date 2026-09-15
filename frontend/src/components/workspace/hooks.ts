"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { outboundLog, serverSnapshot } from "@/lib/outbound-log";
import { pinStore, type Pin } from "@/lib/pins";

export function useOutboundLog() {
  return useSyncExternalStore(outboundLog.subscribe, outboundLog.snapshot, serverSnapshot);
}

export function usePins() {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      pinStore
        .list()
        .then((list) => alive && setPins(list))
        .catch(() => {
          // Gizli pencere veya engellenmiş site verisinde IndexedDB açılmayabilir; pano devre dışı kalır.
          if (alive) {
            setError(true);
            setPins([]);
          }
        });
    void refresh();
    const unsubscribe = pinStore.subscribe(() => void refresh());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { pins, unavailable: error };
}
