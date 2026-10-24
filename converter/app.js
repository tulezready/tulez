(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DONUT = { size: 300, outer: 140, inner: 62 };

  // ---------- settings ----------

  const DEFAULTS = { quality: 0.9, maxDim: 0, pdfDpi: 150, autoDownload: true };
  const settings = { ...DEFAULTS, ...loadSettings() };

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem("converter-settings")) || {};
    } catch {
      return {};
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem("converter-settings", JSON.stringify(settings));
    } catch {
      /* storage unavailable: settings last for this visit only */
    }
  }

  function bindSettings() {
    const quality = $("quality");
    const showQuality = () => ($("quality-out").value = `${Math.round(settings.quality * 100)}%`);
    quality.value = settings.quality;
    showQuality();
    quality.addEventListener("input", () => {
      settings.quality = Number(quality.value);
      showQuality();
      saveSettings();
    });
    for (const [id, key] of [["max-dim", "maxDim"], ["pdf-dpi", "pdfDpi"]]) {
      const el = $(id);
      el.value = String(settings[key]);
      el.addEventListener("change", () => {
        settings[key] = Number(el.value);
        saveSettings();
      });
    }
    const auto = $("auto-dl");
    auto.checked = settings.autoDownload;
    auto.addEventListener("change", () => {
      settings.autoDownload = auto.checked;
      saveSettings();
    });
  }

  // ---------- drag & drop ----------

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");

  function bindDrop() {
    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      $("drag-hint").hidden = false;
      $("dropzone").classList.add("over");
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      if (--dragDepth <= 0) endDrag();
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      endDrag();
      const files = [...e.dataTransfer.files];
      if (files.length) openDonut(files, e.clientX, e.clientY);
    });

    const input = $("file-input");
    $("pick").addEventListener("click", () => input.click());
    $("dropzone").addEventListener("keydown", (e) => {
      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";
      if (!files.length) return;
      const r = $("pick").getBoundingClientRect();
      openDonut(files, r.left + r.width / 2, r.top + r.height / 2);
    });
  }

  function endDrag() {
    dragDepth = 0;
    $("drag-hint").hidden = true;
    $("dropzone").classList.remove("over");
  }

  // ---------- donut ----------

  let lastFocus = null;

  function polar(r, angle) {
    const a = ((angle - 90) * Math.PI) / 180;
    const c = DONUT.size / 2;
    return [c + r * Math.cos(a), c + r * Math.sin(a)];
  }

  function segmentPath(start, end) {
    const { outer, inner } = DONUT;
    const large = end - start > 180 ? 1 : 0;
    const [x1, y1] = polar(outer, start);
    const [x2, y2] = polar(outer, end);
    const [x3, y3] = polar(inner, end);
    const [x4, y4] = polar(inner, start);
    return `M${x1} ${y1}A${outer} ${outer} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}Z`;
  }

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  function shorten(name, max) {
    return name.length > max ? name.slice(0, max - 1) + "…" : name;
  }

  function openDonut(files, x, y) {
    endDrag();
    const targets = Converters.targetsFor(files);
    const layer = $("donut-layer");
    const donut = $("donut");
    donut.replaceChildren();
    lastFocus = document.activeElement;

    const half = DONUT.size / 2 + 8;
    const cx = Math.min(Math.max(x, half), window.innerWidth - half);
    const cy = Math.min(Math.max(y, half), window.innerHeight - half);
    donut.style.left = `${cx - DONUT.size / 2}px`;
    donut.style.top = `${cy - DONUT.size / 2}px`;

    const svg = svgEl("svg", { viewBox: `0 0 ${DONUT.size} ${DONUT.size}` });
    const style = getComputedStyle(document.documentElement);
    const sweep = 360 / targets.length;
    const fontSize = targets.length > 12 ? 11 : 13;

    targets.forEach((t, i) => {
      const start = i * sweep;
      const end = start + Math.min(sweep, 359.99);
      const g = svgEl("g", { class: "seg", tabindex: "0", role: "button", "aria-label": `Convert to ${t.label}` });
      g.appendChild(svgEl("path", { d: segmentPath(start, end), fill: style.getPropertyValue(`--cat-${t.category}`).trim() }));
      const [lx, ly] = polar((DONUT.outer + DONUT.inner) / 2, start + (end - start) / 2);
      g.appendChild(svgEl("text", { x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "central", "font-size": fontSize }, t.label));
      const choose = () => {
        closeDonut();
        runJob(files, t);
      };
      g.addEventListener("click", choose);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      });
      svg.appendChild(g);
    });

    const c = DONUT.size / 2;
    svg.appendChild(svgEl("circle", { class: "hub", cx: c, cy: c, r: DONUT.inner - 4 }));
    const title = files.length === 1 ? shorten(files[0].name, 14) : `${files.length} files`;
    svg.appendChild(svgEl("text", { class: "hub-text", x: c, y: c - 6, "text-anchor": "middle" }, title));
    svg.appendChild(svgEl("text", { class: "hub-sub", x: c, y: c + 12, "text-anchor": "middle" }, "Esc to cancel"));
    donut.appendChild(svg);

    layer.hidden = false;
    const first = donut.querySelector(".seg");
    if (first) first.focus();
  }

  function closeDonut() {
    $("donut-layer").hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function bindDonut() {
    $("donut-layer").addEventListener("click", (e) => {
      if (e.target === e.currentTarget || e.target.classList.contains("hub")) closeDonut();
    });
    document.addEventListener("keydown", (e) => {
      if ($("donut-layer").hidden) return;
      if (e.key === "Escape") closeDonut();
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const segs = [...document.querySelectorAll("#donut .seg")];
        const i = segs.indexOf(document.activeElement);
        const next = segs[(i + (e.key === "ArrowRight" ? 1 : segs.length - 1)) % segs.length];
        if (next) next.focus();
      }
    });
  }

  // ---------- jobs ----------

  const objectUrls = [];

  function link(result, cls) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(result.blob);
    objectUrls.push(url);
    a.href = url;
    a.download = result.name.split("/").pop();
    a.textContent = result.name;
    if (cls) a.className = cls;
    return a;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  async function runJob(files, target) {
    const list = $("results");
    list.querySelector(".empty")?.remove();
    $("clear").hidden = false;

    const li = el("li", "job");
    const head = el("div", "job-head");
    const label = files.length === 1 ? files[0].name : `${files.length} files`;
    head.append(el("span", "job-title", `${label} → ${target.label}`));
    const status = el("span", "job-status");
    status.append(el("span", "spinner"), document.createTextNode("Converting…"));
    head.append(status);
    li.append(head);
    list.prepend(li);

    const results = [];
    const errors = [];
    try {
      await Converters.convert(files, target.to, settings, (file, res) => {
        if (res instanceof Error) errors.push(`${file.name}: ${res.message}`);
        else results.push(...res);
      });
    } catch (e) {
      errors.push(e.message || String(e));
    }

    status.className = `job-status ${errors.length && !results.length ? "err" : "ok"}`;
    status.textContent = results.length
      ? `Done · ${results.length} file${results.length > 1 ? "s" : ""}${errors.length ? ` · ${errors.length} failed` : ""}`
      : "Failed";

    if (results.length) {
      const box = el("div", "job-files");
      let primary;
      if (results.length > 1) {
        primary = await Converters.zipResults(results, `${target.label.toLowerCase()}-files.zip`);
        const all = link(primary, "all");
        all.textContent = "Download all (.zip)";
        box.append(all);
      } else primary = results[0];
      for (const r of results) box.append(link(r));
      li.append(box);
      if (settings.autoDownload) link(primary).click();
    }
    if (errors.length) {
      const ul = el("ul", "job-errors");
      for (const msg of errors) ul.append(el("li", null, msg));
      li.append(ul);
    }
  }

  function bindClear() {
    $("clear").addEventListener("click", () => {
      objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      $("results").replaceChildren(el("li", "empty", "Converted files show up here."));
      $("clear").hidden = true;
    });
  }

  bindSettings();
  bindDrop();
  bindDonut();
  bindClear();
})();
