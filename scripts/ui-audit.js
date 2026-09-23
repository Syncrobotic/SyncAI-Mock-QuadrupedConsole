async (page) => {
  const results = [];
  const measure = async (label) => {
    const r = await page.evaluate(() => {
      const vis = (el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05;
      };
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.tagName).trim().replace(/\s+/g, " ").slice(0, 28);
      // Floating things over the map panel
      const floats = [
        ...document.querySelectorAll('[aria-expanded][class*="backdrop-blur"], [aria-label="電量與連線"], [role="status"], [aria-label="跟隨"], [aria-label="回到通話"], [aria-label="圖層"]'),
      ].filter(vis);
      const overlaps = [];
      for (let i = 0; i < floats.length; i++)
        for (let j = i + 1; j < floats.length; j++) {
          const a = floats[i].getBoundingClientRect();
          const b = floats[j].getBoundingClientRect();
          if (floats[i].contains(floats[j]) || floats[j].contains(floats[i])) continue;
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ix > 2 && iy > 2) overlaps.push(`${name(floats[i])} ⟂ ${name(floats[j])} (${Math.round(ix)}×${Math.round(iy)})`);
        }
      // View-button stack vs the whole map panel
      const panel = document.querySelector(".bg-map-ground");
      const mapH = panel ? Math.round(panel.getBoundingClientRect().height) : null;
      // Canvas area actually uncovered by floating UI (rough: panel minus header stack bottom)
      const stack = panel?.querySelector(".pointer-events-none.absolute.inset-x-0.top-0");
      const stackBottom = stack ? stack.getBoundingClientRect().bottom - panel.getBoundingClientRect().top : 0;
      // Touch targets
      const small = [...document.querySelectorAll('button, [role="tab"], select, input:not([type=checkbox]):not([type=range]), a')]
        .filter(vis)
        .filter((el) => !el.closest("aside"))
        .map((el) => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width < 43.5 || b.height < 43.5)
        .map(({ el, b }) => `${name(el)} ${Math.round(b.width)}×${Math.round(b.height)}`);
      // Truncated text
      const trunc = [...document.querySelectorAll(".truncate")]
        .filter(vis)
        .filter((el) => !el.closest("aside") && el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.innerText.trim().slice(0, 30));
      // Sheet
      const sheet = [...document.querySelectorAll(".rounded-2xl.border")].find((e) => e.querySelector('[role="tablist"]'));
      const scroller = sheet?.querySelector(".overflow-y-auto");
      return {
        mapH,
        headerStackBottom: Math.round(stackBottom),
        overlaps,
        small: [...new Set(small)],
        trunc: [...new Set(trunc)],
        sheetH: sheet ? Math.round(sheet.getBoundingClientRect().height) : null,
        sheetScroll: scroller ? `${scroller.clientHeight}/${scroller.scrollHeight}` : null,
      };
    });
    results.push({ label, ...r });
  };

  const setSnap = (n) => page.evaluate((n) => window.__qcSet?.({ snap: n }), n);
  const go = async (scenario, vw, vh) => {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(`http://localhost:3200/?scenario=${scenario}`);
    await page.waitForTimeout(3000);
  };

  for (const [vw, vh, dev] of [
    [1100, 920, "14"],
    [375, 667, "SE"],
  ]) {
    await go("default", vw, vh);
    for (const tab of ["操控", "任務", "通話", "裝置"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(tab === "通話" ? 5000 : 800);
      for (const snap of tab === "操控" ? [1] : [0, 1, 2]) {
        await setSnap(snap);
        await page.waitForTimeout(450);
        await measure(`${dev} ${tab} snap${snap}`);
        await page.screenshot({ path: `.playwright-mcp/audit-${dev}-${tab}-${snap}.png` });
      }
    }
    // call running + teleop → PiP
    await page.getByRole("tab", { name: "操控" }).click();
    await page.waitForTimeout(800);
    await page.getByLabel("電量與連線").click();
    await page.waitForTimeout(300);
    await measure(`${dev} 操控 + 通話PiP + 狀態展開`);
    await page.screenshot({ path: `.playwright-mcp/audit-${dev}-pip-status.png` });
    await page.getByLabel("電量與連線").click();

    await go("weak_signal", vw, vh);
    await page.waitForTimeout(9000);
    await measure(`${dev} weak_signal`);
    await page.screenshot({ path: `.playwright-mcp/audit-${dev}-weak.png` });

    await go("gateway_down", vw, vh);
    await page.evaluate(() => window.__qcFire?.("gateway_down"));
    await page.waitForTimeout(2000);
    await measure(`${dev} BleOnly`);
    await page.screenshot({ path: `.playwright-mcp/audit-${dev}-ble.png` });
  }
  return results;
}
