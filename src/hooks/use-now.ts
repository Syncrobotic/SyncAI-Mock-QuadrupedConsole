import { useEffect, useState } from "react";

/** The current time, re-read every `interval` ms — render code never calls Date.now(). */
export function useNow(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
