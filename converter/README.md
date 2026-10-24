# Tulez Converter

A drag-and-drop file converter that runs entirely in the browser. Files never leave your device: there is no server and nothing is uploaded.

The idea comes from [Filee](https://github.com/KnifeLemon/Filee), a desktop app (MIT). When you drop files, a ring of formats opens at your cursor and shows only the formats that fit those files. You pick one, and the converted file downloads.

## Run it

The page has to be served over `http://`, because browsers block the PDF engine's worker on `file://`. Any static server works:

```sh
cd converter
python3 -m http.server 8000
# open http://localhost:8000
```

It also works as-is on GitHub Pages or Netlify. Every library is in `vendor/`, so once the page loads it needs no internet.

## Formats

| From | To |
| --- | --- |
| PNG, JPG, WebP, GIF, BMP, ICO, SVG, AVIF, HEIC | PNG, JPG, WebP, BMP, ICO, PDF (several images → one PDF) |
| PDF | PNG or JPG (one per page), TXT |
| DOCX | HTML, Markdown, TXT, PDF (text only) |
| Markdown | HTML, TXT, PDF (text only) |
| HTML | Markdown, TXT, PDF (text only) |
| TXT | PDF, HTML |
| XLSX, XLS, ODS, CSV, TSV, Numbers | XLSX, ODS, CSV, TSV, JSON, HTML |
| JSON ↔ YAML; JSON/YAML records | CSV, XLSX |
| MP3, M4A, OGG, FLAC, MP4, WebM… | WAV (audio track); video → a still frame as PNG/JPG |
| Anything | ZIP; ZIP → the files inside |

Limits compared with Filee: it can't encode MP3, MP4 or other video formats, can't make PDFs that keep a document's layout, and has no HWP, e-book, CAD or font formats. The built-in PDF fonts only cover Latin text. Audio and video decoding depends on what the browser supports.

## Files

- `index.html`: the page
- `styles.css`: styles, light and dark
- `app.js`: drag and drop, the format ring, results
- `converters.js`: the conversion engine; add a format by adding an entry to `CONVERTERS`
- `vendor/`: third-party libraries (see `vendor/LICENSES.md`)
