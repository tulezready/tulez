// Conversion engine. Every converter runs in the browser; nothing is uploaded.
// A converter takes input files and returns [{ name, blob }].

(function () {
  "use strict";

  const EXT_ALIASES = { jpeg: "jpg", jfif: "jpg", htm: "html", yml: "yaml", markdown: "md", heif: "heic", tif: "tiff" };

  const CATEGORIES = {
    image: ["png", "jpg", "webp", "gif", "bmp", "ico", "svg", "avif", "heic"],
    pdf: ["pdf"],
    document: ["docx", "md", "html", "txt"],
    sheet: ["xlsx", "xls", "xlsm", "ods", "csv", "tsv", "numbers"],
    data: ["json", "yaml"],
    audio: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"],
    video: ["mp4", "webm", "mov", "m4v", "ogv"],
    archive: ["zip"],
  };

  // The category a target format is shown under in the donut.
  const TARGET_CATEGORY = {
    png: "image", jpg: "image", webp: "image", bmp: "image", ico: "image",
    pdf: "pdf",
    html: "document", md: "document", txt: "document",
    xlsx: "sheet", ods: "sheet", csv: "sheet", tsv: "sheet",
    json: "data", yaml: "data",
    wav: "audio",
    zip: "archive", files: "archive",
  };

  const MIME = {
    png: "image/png", jpg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
    pdf: "application/pdf", html: "text/html;charset=utf-8", md: "text/markdown;charset=utf-8",
    txt: "text/plain;charset=utf-8", csv: "text/csv;charset=utf-8", tsv: "text/tab-separated-values;charset=utf-8",
    json: "application/json;charset=utf-8", yaml: "application/yaml;charset=utf-8", wav: "audio/wav",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ods: "application/vnd.oasis.opendocument.spreadsheet", zip: "application/zip",
  };

  function extOf(name) {
    const dot = name.lastIndexOf(".");
    if (dot < 0) return "";
    const ext = name.slice(dot + 1).toLowerCase();
    return EXT_ALIASES[ext] || ext;
  }

  function baseName(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function categoryOf(ext) {
    for (const [cat, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return cat;
    return null;
  }

  function textBlob(text, ext) {
    return new Blob([text], { type: MIME[ext] });
  }

  function out(file, ext, blob, suffix = "") {
    return { name: `${baseName(file.name)}${suffix}.${ext}`, blob };
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function htmlPage(title, body, extraStyle = "") {
    return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.55}` +
      `table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}${extraStyle}</style></head>` +
      `<body>\n${body}\n</body></html>\n`;
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("script,style").forEach((el) => el.remove());
    doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
    doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,pre,blockquote").forEach((el) => el.append("\n"));
    return (doc.body ? doc.body.textContent : "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }

  function turndown() {
    return new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  }

  // ---------- images ----------

  async function decodeImage(file) {
    let blob = file;
    if (extOf(file.name) === "heic") {
      const result = await heic2any({ blob: file, toType: "image/png" });
      blob = Array.isArray(result) ? result[0] : result;
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode().catch(() => {
        throw new Error("This browser can't read this image.");
      });
      // SVGs without intrinsic size report 0; give them a sensible canvas.
      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      return { img, w, h };
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  function fitSize(w, h, maxDim) {
    if (!maxDim || (w <= maxDim && h <= maxDim)) return [w, h];
    const s = maxDim / Math.max(w, h);
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  }

  async function imageToCanvas(file, opts, { background = null, maxDim = opts.maxDim } = {}) {
    const { img, w, h } = await decodeImage(file);
    const [cw, ch] = fitSize(w, h, maxDim);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas;
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b && b.type === mime ? resolve(b) : reject(new Error(`This browser can't write ${mime}.`))), mime, quality)
    );
  }

  function encodeBmp(canvas) {
    const { width: w, height: h } = canvas;
    const data = canvas.getContext("2d").getImageData(0, 0, w, h).data;
    const rowSize = Math.ceil((w * 3) / 4) * 4;
    const size = 54 + rowSize * h;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    v.setUint16(0, 0x4d42, true);
    v.setUint32(2, size, true);
    v.setUint32(10, 54, true);
    v.setUint32(14, 40, true);
    v.setInt32(18, w, true);
    v.setInt32(22, h, true);
    v.setUint16(26, 1, true);
    v.setUint16(28, 24, true);
    v.setUint32(34, rowSize * h, true);
    v.setInt32(38, 2835, true);
    v.setInt32(42, 2835, true);
    const bytes = new Uint8Array(buf);
    for (let y = 0; y < h; y++) {
      let o = 54 + (h - 1 - y) * rowSize;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        bytes[o++] = data[i + 2];
        bytes[o++] = data[i + 1];
        bytes[o++] = data[i];
      }
    }
    return new Blob([buf], { type: MIME.bmp });
  }

  async function encodeIco(file, opts) {
    const { img, w, h } = await decodeImage(file);
    const size = Math.min(256, Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const [dw, dh] = fitSize(w, h, size);
    canvas.getContext("2d").drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    const png = new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());
    const header = new DataView(new ArrayBuffer(22));
    header.setUint16(2, 1, true);
    header.setUint16(4, 1, true);
    header.setUint8(6, size === 256 ? 0 : size);
    header.setUint8(7, size === 256 ? 0 : size);
    header.setUint16(10, 1, true);
    header.setUint16(12, 32, true);
    header.setUint32(14, png.length, true);
    header.setUint32(18, 22, true);
    return new Blob([header.buffer, png], { type: MIME.ico });
  }

  async function imagesToPdf(files, opts) {
    const { jsPDF } = window.jspdf;
    let doc = null;
    for (const file of files) {
      const canvas = await imageToCanvas(file, opts, { background: "#ffffff" });
      // 96 px per inch -> 72 pt per inch.
      const pw = canvas.width * 0.75;
      const ph = canvas.height * 0.75;
      const orientation = pw > ph ? "landscape" : "portrait";
      if (!doc) doc = new jsPDF({ unit: "pt", format: [pw, ph], orientation });
      else doc.addPage([pw, ph], orientation);
      doc.addImage(canvas.toDataURL("image/jpeg", opts.quality), "JPEG", 0, 0, pw, ph);
    }
    return doc.output("blob");
  }

  // ---------- PDF ----------

  let pdfReady = false;
  async function openPdf(file) {
    if (!pdfReady) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
      pdfReady = true;
    }
    return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  }

  async function pdfToImages(file, opts, ext) {
    const pdf = await openPdf(file);
    const results = [];
    const pad = String(pdf.numPages).length;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: opts.pdfDpi / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await canvasToBlob(canvas, MIME[ext], opts.quality);
      const suffix = pdf.numPages > 1 ? `-p${String(n).padStart(pad, "0")}` : "";
      results.push(out(file, ext, blob, suffix));
      page.cleanup();
    }
    await pdf.destroy();
    return results;
  }

  async function pdfToText(file) {
    const pdf = await openPdf(file);
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      pages.push(content.items.map((it) => it.str + (it.hasEOL ? "\n" : "")).join(""));
    }
    await pdf.destroy();
    return pages.join("\n\n\f").trim() + "\n";
  }

  function textToPdf(text) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 50;
    const lineHeight = 15;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const bottom = doc.internal.pageSize.getHeight() - margin;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    let y = margin;
    for (const line of doc.splitTextToSize(text.replace(/\t/g, "    "), width)) {
      if (y > bottom) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += lineHeight;
    }
    return doc.output("blob");
  }

  // ---------- documents ----------

  async function docxToHtml(file) {
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }

  // ---------- spreadsheets & data ----------

  async function readWorkbook(file) {
    const ext = extOf(file.name);
    if (ext === "csv" || ext === "tsv") return XLSX.read(await file.text(), { type: "string", FS: ext === "tsv" ? "\t" : undefined });
    return XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  }

  function writeBook(wb, bookType) {
    return new Blob([XLSX.write(wb, { bookType, type: "array" })], { type: MIME[bookType] });
  }

  function perSheet(file, wb, ext, render) {
    const many = wb.SheetNames.length > 1;
    return wb.SheetNames.map((name) =>
      out(file, ext, textBlob(render(wb.Sheets[name]), ext), many ? `-${name.replace(/[\\/:*?"<>|]/g, "_")}` : "")
    );
  }

  function workbookToJson(wb) {
    const sheets = {};
    for (const name of wb.SheetNames) sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
    return wb.SheetNames.length === 1 ? sheets[wb.SheetNames[0]] : sheets;
  }

  async function readData(file) {
    const text = await file.text();
    try {
      return extOf(file.name) === "yaml" ? jsyaml.load(text) : JSON.parse(text);
    } catch (e) {
      throw new Error(`Couldn't parse ${file.name}: ${e.message}`);
    }
  }

  function dataToWorkbook(data) {
    const rows = Array.isArray(data) ? data : data && typeof data === "object" ? [data] : null;
    if (!rows || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r)))
      throw new Error("Only a list of records (objects) can become a table.");
    const flat = rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v]))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat), "Sheet1");
    return wb;
  }

  // ---------- audio & video ----------

  async function decodeAudio(file) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      return await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("This browser can't decode the audio in this file.");
    } finally {
      ctx.close();
    }
  }

  function encodeWav(audio) {
    const channels = audio.numberOfChannels;
    const frames = audio.length;
    const dataSize = frames * channels * 2;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF");
    v.setUint32(4, 36 + dataSize, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, audio.sampleRate, true);
    v.setUint32(28, audio.sampleRate * channels * 2, true);
    v.setUint16(32, channels * 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, dataSize, true);
    const data = [];
    for (let c = 0; c < channels; c++) data.push(audio.getChannelData(c));
    let o = 44;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([buf], { type: MIME.wav });
  }

  async function videoFrame(file, opts, ext) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("This browser can't play this video."));
      });
      await new Promise((resolve) => {
        video.onseeked = resolve;
        video.currentTime = Math.min(1, (video.duration || 0) / 10);
      });
      const [w, h] = fitSize(video.videoWidth, video.videoHeight, opts.maxDim);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(video, 0, 0, w, h);
      return [out(file, ext, await canvasToBlob(canvas, MIME[ext], opts.quality))];
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ---------- archives ----------

  async function unzip(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (!entries.length) throw new Error("The archive is empty.");
    return Promise.all(entries.map(async (f) => ({ name: f.name, blob: await f.async("blob") })));
  }

  async function zipResults(results, name) {
    const zip = new JSZip();
    const seen = new Map();
    for (const r of results) {
      let n = r.name;
      if (seen.has(n)) {
        const count = seen.get(n) + 1;
        seen.set(n, count);
        n = `${baseName(n)} (${count}).${extOf(n)}`;
      } else seen.set(n, 1);
      zip.file(n, r.blob);
    }
    return { name, blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }) };
  }

  // ---------- registry ----------

  const IMG_IN = CATEGORIES.image;
  const SHEET_IN = CATEGORIES.sheet;
  const AV_IN = [...CATEGORIES.audio, ...CATEGORIES.video];

  // Each entry: from (input exts), to (target id), run(file, opts) per file,
  // or combine(files, opts) when the target makes one output from many inputs.
  const CONVERTERS = [
    ...["png", "jpg", "webp"].map((to) => ({
      from: IMG_IN, to,
      run: async (f, o) => [out(f, to, await canvasToBlob(await imageToCanvas(f, o, { background: to === "jpg" ? "#ffffff" : null }), MIME[to], o.quality))],
    })),
    { from: IMG_IN, to: "bmp", run: async (f, o) => [out(f, "bmp", encodeBmp(await imageToCanvas(f, o, { background: "#ffffff" })))] },
    { from: IMG_IN, to: "ico", run: async (f, o) => [out(f, "ico", await encodeIco(f, o))] },
    {
      from: IMG_IN, to: "pdf",
      combine: async (files, o) => [{ name: files.length > 1 ? `${baseName(files[0].name)} and ${files.length - 1} more.pdf` : `${baseName(files[0].name)}.pdf`, blob: await imagesToPdf(files, o) }],
    },

    { from: ["pdf"], to: "png", run: (f, o) => pdfToImages(f, o, "png") },
    { from: ["pdf"], to: "jpg", run: (f, o) => pdfToImages(f, o, "jpg") },
    { from: ["pdf"], to: "txt", run: async (f) => [out(f, "txt", textBlob(await pdfToText(f), "txt"))] },

    { from: ["docx"], to: "html", run: async (f) => [out(f, "html", textBlob(htmlPage(baseName(f.name), await docxToHtml(f)), "html"))] },
    { from: ["docx"], to: "md", run: async (f) => [out(f, "md", textBlob(turndown().turndown(await docxToHtml(f)) + "\n", "md"))] },
    { from: ["docx"], to: "txt", run: async (f) => [out(f, "txt", textBlob((await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value, "txt"))] },
    { from: ["docx"], to: "pdf", run: async (f) => [out(f, "pdf", textToPdf(htmlToText(await docxToHtml(f))))] },

    { from: ["md"], to: "html", run: async (f) => [out(f, "html", textBlob(htmlPage(baseName(f.name), marked.parse(await f.text())), "html"))] },
    { from: ["md"], to: "txt", run: async (f) => [out(f, "txt", textBlob(htmlToText(marked.parse(await f.text())), "txt"))] },
    { from: ["md"], to: "pdf", run: async (f) => [out(f, "pdf", textToPdf(htmlToText(marked.parse(await f.text()))))] },
    { from: ["html"], to: "md", run: async (f) => [out(f, "md", textBlob(turndown().remove(["script", "style"]).turndown(await f.text()) + "\n", "md"))] },
    { from: ["html"], to: "txt", run: async (f) => [out(f, "txt", textBlob(htmlToText(await f.text()), "txt"))] },
    { from: ["html"], to: "pdf", run: async (f) => [out(f, "pdf", textToPdf(htmlToText(await f.text())))] },
    { from: ["txt"], to: "pdf", run: async (f) => [out(f, "pdf", textToPdf(await f.text()))] },
    { from: ["txt"], to: "html", run: async (f) => [out(f, "html", textBlob(htmlPage(baseName(f.name), `<pre>${escapeHtml(await f.text())}</pre>`, "pre{white-space:pre-wrap}"), "html"))] },

    ...["xlsx", "ods"].map((to) => ({ from: SHEET_IN, to, run: async (f) => [out(f, to, writeBook(await readWorkbook(f), to))] })),
    { from: SHEET_IN, to: "csv", run: async (f) => perSheet(f, await readWorkbook(f), "csv", (s) => XLSX.utils.sheet_to_csv(s)) },
    { from: SHEET_IN, to: "tsv", run: async (f) => perSheet(f, await readWorkbook(f), "tsv", (s) => XLSX.utils.sheet_to_csv(s, { FS: "\t" })) },
    { from: SHEET_IN, to: "json", run: async (f) => [out(f, "json", textBlob(JSON.stringify(workbookToJson(await readWorkbook(f)), null, 2) + "\n", "json"))] },
    {
      from: SHEET_IN, to: "html",
      run: async (f) => {
        const wb = await readWorkbook(f);
        const body = wb.SheetNames.map((n) => `<h2>${escapeHtml(n)}</h2>\n${XLSX.utils.sheet_to_html(wb.Sheets[n], { header: "", footer: "" })}`).join("\n");
        return [out(f, "html", textBlob(htmlPage(baseName(f.name), body), "html"))];
      },
    },

    { from: ["json"], to: "yaml", run: async (f) => [out(f, "yaml", textBlob(jsyaml.dump(await readData(f)), "yaml"))] },
    { from: ["yaml"], to: "json", run: async (f) => [out(f, "json", textBlob(JSON.stringify(await readData(f), null, 2) + "\n", "json"))] },
    ...["csv", "xlsx"].map((to) => ({
      from: ["json", "yaml"], to,
      run: async (f) => {
        const wb = dataToWorkbook(await readData(f));
        return [out(f, to, to === "csv" ? textBlob(XLSX.utils.sheet_to_csv(wb.Sheets.Sheet1), "csv") : writeBook(wb, "xlsx"))];
      },
    })),

    { from: AV_IN, to: "wav", run: async (f) => [out(f, "wav", encodeWav(await decodeAudio(f)))] },
    { from: CATEGORIES.video, to: "png", run: (f, o) => videoFrame(f, o, "png") },
    { from: CATEGORIES.video, to: "jpg", run: (f, o) => videoFrame(f, o, "jpg") },

    { from: ["zip"], to: "files", label: "Unzip", run: (f) => unzip(f) },
    {
      from: "*", to: "zip",
      combine: async (files) => [await zipResults(files.map((f) => ({ name: f.name, blob: f })), files.length > 1 ? "Archive.zip" : `${files[0].name}.zip`)],
    },
  ];

  function convertersFor(file) {
    const ext = extOf(file.name);
    return CONVERTERS.filter((c) => (c.from === "*" || c.from.includes(ext)) && c.to !== ext);
  }

  // Targets that fit every file in the set, in registry order.
  function targetsFor(files) {
    if (!files.length) return [];
    const lists = files.map((f) => convertersFor(f).map((c) => c.to));
    const common = lists.reduce((acc, l) => acc.filter((t) => l.includes(t)));
    return [...new Set(common)].map((to) => ({
      to,
      label: (CONVERTERS.find((c) => c.to === to && c.label) || {}).label || to.toUpperCase(),
      category: TARGET_CATEGORY[to] || "archive",
    }));
  }

  // Runs one target over a set of files. onFile(file, results | Error) reports each step.
  async function convert(files, to, opts, onFile) {
    const combined = CONVERTERS.find((c) => c.to === to && c.combine && files.every((f) => c.from === "*" || c.from.includes(extOf(f.name))));
    if (combined) {
      const results = await combined.combine(files, opts);
      onFile(null, results);
      return;
    }
    for (const file of files) {
      const conv = convertersFor(file).find((c) => c.to === to);
      try {
        onFile(file, await conv.run(file, opts));
      } catch (e) {
        onFile(file, e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  function supportedInputs() {
    return [...new Set(CONVERTERS.flatMap((c) => (c.from === "*" ? [] : c.from)))];
  }

  window.Converters = { targetsFor, convert, zipResults, supportedInputs, extOf, categoryOf };
})();
