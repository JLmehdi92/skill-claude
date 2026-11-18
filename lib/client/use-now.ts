"use client";

import { useEffect, useState } from "react";
import { serverNow } from "./api";

/** The server's current time (corrected for this device's clock), refreshed every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
