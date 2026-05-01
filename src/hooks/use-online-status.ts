import { useEffect, useState } from "react";

/**
 * Reactive wrapper around `navigator.onLine`.
 * Note: navigator.onLine only tells us if the device thinks it has any
 * network. It can be `true` while requests still time out — but it's the
 * right primitive for showing an "offline mode" banner.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return online;
}