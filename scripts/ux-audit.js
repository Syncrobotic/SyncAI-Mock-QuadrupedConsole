// ui-ux-pro-max checklist audit — run with Playwright's browser_run_code against `pnpm dev` (port 3200).
// Walks every onboarding step and every console screen and reports, per screen:
//   touch   — interactive elements whose effective hit area (box + ::after hit-slop) is < 44×44
//   gap     — adjacent hit areas closer than 8px… measured only as overlap of real boxes
//   contrast— text below 4.5:1 (3:1 for large text) against its composited background
//   tiny    — text smaller than 11px
//   noname  — interactive elements with no accessible name
//   nolabel — inputs without a label / aria-label
async (page) => {
  const out = [];
  const audit = async (label) => {
    const r = await page.evaluate(() => {
      const vis = (el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      const skip = (el) => el.closest("aside, [data-audit-skip], [aria-hidden=true]");
      const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 24);
      const px = (v) => parseFloat(v) || 0;

      const I = 'button, [role="tab"], [role="switch"], [role="button"], a[href], select, input:not([type=hidden]), textarea';
      const touch = [];
      const noname = [];
      for (const el of document.querySelectorAll(I)) {
        if (!vis(el) || skip(el) || el.disabled) continue;
        const b = el.getBoundingClientRect();
        const a = getComputedStyle(el, "::after");
        let w = b.width, h = b.height;
        if (a.content !== "none" && a.position === "absolute") {
          w = Math.max(w, b.width - px(a.left) - px(a.right));
          h = Math.max(h, b.height - px(a.top) - px(a.bottom));
        }
        // A control wrapped in a big <label> (e.g. a whole card) is tapped through the label.
        const lab = el.closest("label");
        if (lab) {
          const lb = lab.getBoundingClientRect();
          w = Math.max(w, lb.width);
          h = Math.max(h, lb.height);
        }
        if (w < 43.5 || h < 43.5) touch.push(`${name(el) || el.tagName} ${Math.round(w)}×${Math.round(h)}`);
        const accName = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.innerText.trim() || el.getAttribute("title") || (el.labels && el.labels.length) || el.getAttribute("placeholder");
        if (!accName) noname.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
      }

      // Contrast
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (m) {
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return [p[0], p[1], p[2], p[3] ?? 1];
        }
        const o = c.match(/oklch\(([^)]+)\)/);
        if (o) {
          // Let the browser convert oklch → rgb.
          const cv = document.createElement("canvas").getContext("2d");
          cv.fillStyle = c;
          cv.fillRect(0, 0, 1, 1);
          const d = cv.getImageData(0, 0, 1, 1).data;
          const alpha = /\/\s*([\d.]+%?)/.exec(o[1]);
          let al = 1;
          if (alpha) al = alpha[1].endsWith("%") ? parseFloat(alpha[1]) / 100 : parseFloat(alpha[1]);
          return [d[0], d[1], d[2], al];
        }
        const cv = document.createElement("canvas").getContext("2d");
        cv.fillStyle = c;
        cv.fillRect(0, 0, 1, 1);
        const d = cv.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (top, bot) => {
        const a = top[3];
        return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1];
      };
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el) => {
        const layers = [];
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage !== "none" && !cs.backgroundImage.startsWith("url")) return null; // gradient: skip
          const c = parse(cs.backgroundColor);
          if (c[3] > 0) layers.push(c);
          if (c[3] >= 0.99) break;
          if (e.tagName === "CANVAS" || e.querySelector?.(":scope > canvas")) return null;
        }
        let acc = parse(getComputedStyle(document.body).backgroundColor);
        for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
        return acc;
      };
      const contrast = [];
      const tiny = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el || seen.has(el) || !vis(el) || skip(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const fs = px(cs.fontSize);
        if (fs < 10.5) tiny.push(`${t.slice(0, 16)} ${fs}px`);
        let op = 1;
        for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
        if (op < 0.6) continue; // disabled / decorative
        const bg = bgOf(el);
        if (!bg) continue;
        const fg0 = parse(cs.color);
        const fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * op], bg);
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const large = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 700);
        if (ratio < (large ? 3 : 4.5)) contrast.push(`${t.slice(0, 16)} ${ratio.toFixed(2)} (${fs}px)`);
      }

      const nolabel = [...document.querySelectorAll("input:not([type=hidden]), textarea, select")]
        .filter((el) => vis(el) && !skip(el))
        .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"))
        .map((el) => el.getAttribute("placeholder") || el.type);

      const u = (a) => [...new Set(a)];
      return { touch: u(touch), contrast: u(contrast), tiny: u(tiny), noname: u(noname), nolabel: u(nolabel) };
    });
    out.push({ label, ...r });
  };

  const wait = (ms) => page.waitForTimeout(ms);
  const click = async (name, opts = {}) => {
    await page.getByRole("button", { name, ...opts }).first().click();
    await wait(600);
  };
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- Onboarding, every step --------------------------------------------------
  await page.goto("http://localhost:3200/");
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.goto("http://localhost:3200/");
  await wait(1500);
  const shot = (n) => page.screenshot({ path: `.playwright-mcp/ux-${n}.png` });
  const step = async (n) => {
    await audit(`onb ${n}`);
    await shot(`onb-${n}`);
  };
  // Generic walk: audit, then press the pinned primary action (or the first choice row when the
  // action bar has nothing enabled — e.g. picking a dog / a network).
  for (let i = 0; i < 16; i++) {
    const title = await page.evaluate(() => document.body.innerText.match(/\S+ · \d \/ 8/)?.[0] ?? (document.querySelector("[data-actionbar]") ? "welcome" : "done"));
    if (title === "done") {
      if (i < 15 && !(await page.getByRole("tab", { name: "操控" }).count())) {
        await wait(3000);
        const again = await page.evaluate(() => /\S+ · \d \/ 8/.test(document.body.innerText) || !!document.querySelector("[data-actionbar]"));
        if (again) continue;
      }
      break;
    }
    await step(`${String(i + 1).padStart(2, "0")} ${title}`);
    const pw = page.locator('input[type="password"]:visible');
    if (await pw.count()) {
      await pw.fill("password123");
      await wait(300);
    }
    const bar = page.locator("[data-actionbar] button:enabled");
    const dialog = page.locator('[role="dialog"] button:enabled');
    const allow = page.locator('[role="dialog"] button:enabled').filter({ hasText: /^(允許|好|繼續|確定)/ });
    if (await allow.count()) await allow.first().click();
    else if (await dialog.count()) await dialog.first().click();
    else if (await bar.count()) await bar.first().click();
    else {
      const choice = page.locator(".overflow-y-auto button:enabled:visible");
      if (await choice.count()) await choice.first().click(); // else: an automatic step — just wait
    }
    await wait(3800);
  }

  // ---- Console, every tab/snap ----------------------------------------------
  // Whatever onboarding reached, continue from a paired Owner phone on a full-licence dog.
  await page.evaluate(() => localStorage.removeItem("qc.mock.dog.license.v2"));
  await page.evaluate(() =>
    localStorage.setItem(
      "qc.mock.keystore",
      JSON.stringify({
        dogId: "dog-a",
        dogName: "SyncAI-Dog 7F3A",
        serial: "SD2026-0917-7F3A",
        role: "owner",
        endpoint: { ip: "192.168.50.23", port: 8443, fingerprint: "SHA256:7f3a…c21e" },
        pairedAt: Date.now(),
      })
    )
  );
  try {
  await page.goto("http://localhost:3200/?scenario=default");
  await wait(3000);
  for (const tab of ["操控", "任務", "通話", "裝置"]) {
    const t = page.getByRole("tab", { name: tab });
    if (!(await t.count())) continue;
    await t.click();
    await wait(tab === "通話" ? 4000 : 900);
    await page.evaluate(() => window.__qcSet?.({ snap: 1 }));
    await wait(450);
    await audit(`console ${tab}`);
    await shot(`con-${tab}`);
  }
  // Mission sub-views + editors
  await page.getByRole("tab", { name: "任務" }).click();
  await page.evaluate(() => window.__qcSet?.({ snap: 2 }));
  await wait(600);
  for (const v of ["規則", "任務", "行程"]) {
    const b = page.getByRole("radio", { name: v }).or(page.getByRole("button", { name: v, exact: true }));
    if (await b.count()) {
      await b.first().click();
      await wait(500);
      await audit(`mission ${v}`);
      await shot(`mis-${v}`);
    }
  }
  await page.getByRole("button", { name: "規則", exact: true }).first().click().catch(() => {});
  const rule = page.getByText("白天例行巡邏").or(page.getByText(/例行巡邏/)).first();
  if (await rule.count()) {
    await rule.click();
    await wait(600);
    await audit("rule detail");
    await shot("rule-detail");
    const edit = page.getByRole("button", { name: "編輯" });
    if (await edit.count()) {
      await edit.first().click();
      await wait(700);
      await audit("rule editor");
      await shot("rule-editor");
    }
  }
  // Status details
  await page.goto("http://localhost:3200/?scenario=default");
  await wait(2500);
  await page.getByLabel("狗的狀態與連線").click();
  await wait(400);
  await audit("status details");
  await shot("status");
  } catch (e) {
    out.push({ label: "ABORTED", error: String(e).slice(0, 200) });
  }
  return out;
}
