import { useEffect } from "react";

/**
 * On-screen keyboard height → `--kb` on <html>.
 *
 * The WebViews differ: iOS overlays the keyboard on the layout viewport,
 * Android usually resizes it. `visualViewport` reports the visible band in
 * both, so `innerHeight − (vv.height + vv.offsetTop)` is how much of the page
 * the keyboard hides. Scroll areas pad by it, and a focused field is scrolled
 * into the band that is still visible — the sheet and the E-Stop live at the
 * bottom, exactly where the keyboard lands.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty("--kb", `${kb > 80 ? kb : 0}px`);
    };
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.matches("input, textarea, select")) setTimeout(() => t.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocus);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);
}
