# LibreNotebook

> An open-source NotebookLM. Pick any AI provider you want — OpenAI-compatible API or a local Ollama — feed it sources, ask grounded questions, and generate Mermaid infographics. Built on Deno + Fresh + LangChain.js.

## Screenshots

| Main menu | Notebook view |
|-----------|---------------|
| ![Main menu](docs/screenshots/main-menu.png) | ![Notebook view](docs/screenshots/notebook-view.png) |

*(Placeholder PNGs ship with the repo — replace `docs/screenshots/main-menu.png` and `docs/screenshots/notebook-view.png` with real captures of your install.)*

---

## Features

**Notebooks dashboard**
- Create, **rename** (inline), **delete** (with confirm), and sort notebooks
- Sort by *Most recent*, *Oldest first*, *A → Z*, *Z → A*

**Sources** — paste anything, retrieval is text-based but the LLM can look at images in-context when it has vision
- **Paste text** snippets
- **Fetch URL** — Mozilla **Readability** strips the page to its readable article, downloads inline images
- **YouTube** — `yt-dlp` pulls the video's transcript (manual subs preferred, auto-captions otherwise)
- **PDF upload** — Mozilla **PDF.js** extracts text + embedded raster images
- Per-source delete + status (`pending` → `ready` / `failed`) with a chunk-level progress bar
- Per-source favicon (Google `s2/favicons` for plain URLs, YouTube glyph for videos)

**Chat with your sources**
- NDJSON streaming chat with inline `[N]` citation badges
- Hover a citation → quick chunk preview
- Click a citation → drawer with the **full source** and the cited chunk highlighted in context
- Auto-generated **summary** + 3 clickable **suggested questions** every time you open a notebook
- Vision-aware context: when the LLM has vision (auto-detected for Ollama via `/api/show`, manual toggle for OpenAI), images extracted from the cited PDFs / webpages ride along on the chat request

**Studio (right pane)**
- **Mermaid Infographic** generator with a *Customise infographic* modal: language, orientation, visual style carousel, level of detail, free-form prompt
- ≥3 refinement iterations — each pass renders the diagram, screenshots the SVG to PNG, posts it back to a vision-capable LLM for critique, and emits an improved Mermaid block
- Studio item cards show in-flight generations as *"Generating infographic… based on N sources · iter 2/3"* and flip to a clickable card with a derived title once finished
- The final diagram lands as an assistant chat message with a fenced ` ```mermaid ` block that `MermaidView` renders inline

**Settings / providers**
- **OpenAI-compatible** (works with OpenAI proper, Together, Groq, vLLM, OpenRouter, …) and **Ollama** side-by-side
- **Test connection** lists every model the server exposes
- Searchable **Model dropdown** (filter as you type, accept any unknown value)
- **Auto-detect vision** for Ollama (probes `/api/show`'s `capabilities`); manual toggle for OpenAI
- Ollama **Auto context window** — at request time looks up the model's `model_info.<family>.context_length` and passes it as `numCtx`; or set a custom number
- **Re-embed** button (orange, with confirm) wipes the vector DB and re-embeds every source against the current embedding model

**Persistence**
- Filesystem JSON under `.data/` (settings, notebooks, sources, messages, studio items, jobs)
- Per-notebook vector store as a JSON file using LangChain's `MemoryVectorStore` (drop-in for `@lancedb/lancedb` later — the abstraction in `src/lib/vectorstore.ts` is a single file)
- Logs at `.data/librenotebook.log` (rotating, 5 MB) plus colourised console — see *Logging* below

**Tech stack**
- [Deno](https://deno.com/) 2.x runtime · [Fresh](https://fresh.deno.dev/) (Vite-based) · Preact + signals · [LangChain.js](https://js.langchain.com/) · [Mermaid](https://mermaid.js.org/) · [Mozilla Readability](https://github.com/mozilla/readability) · [pdfjs-dist](https://github.com/mozilla/pdf.js) · [yt-dlp](https://github.com/yt-dlp/yt-dlp) · [Neutralinojs](https://neutralino.js.org/) for the desktop window

---

## Quick start (development)

```bash
# 1. Clone
git clone https://github.com/impulse/LibreNotebook
cd LibreNotebook

# 2. Run the Fresh dev server
deno task dev
#    → http://localhost:5173

# (optional) Run inside a Neutralino desktop window
deno task neu
```

The first time you visit `/` you'll be sent to `/onboarding`. Configure your LLM and embedding providers, click *Test connection*, then *Save and continue*.

### Optional system dependencies
- **`yt-dlp`** — only needed to ingest YouTube transcripts. Install with one of:
  ```
  pip install --user yt-dlp     # ~/.local/bin/yt-dlp
  apt install yt-dlp
  brew install yt-dlp
  ```
  If the binary lives somewhere unusual, point `$YT_DLP_PATH` at it. The server also auto-probes `~/.local/bin`, `~/bin`, and `/usr/local/bin`.
- **A Chromium-class browser for tests** — Puppeteer downloads its own by default. If you'd rather use a system Chrome, set `CHROME_PATH=/usr/bin/google-chrome`.

---

## Run modes

After a release build (see *Building*), the `librenotebook` launcher accepts:

```bash
librenotebook server [--port N]   # headless server only — open the printed URL in any browser
librenotebook window [--port N]   # boots the server, then the desktop window pointing at it
```

Both honour:
- `PORT` — listening port (default `5173`)
- `YT_DLP_PATH` — absolute path to a `yt-dlp` binary if it isn't on `PATH`
- `LOG_LEVEL` — one of `DEBUG`, `INFO` (default), `WARN`, `ERROR`
- `LOG_FILE=0` — disable the `.data/librenotebook.log` file handler

---

## Building

Both packages bundle a self-contained `librenotebook-server` (Deno-compiled from the Vite-built `_fresh/server.js`) plus the Linux Neutralino native binary, dispatched by the launcher above.

### `.deb`

```bash
deno task build:deb
# → dist/librenotebook_<version>_<arch>.deb
```

Requires `dpkg-deb` (any Debian / Ubuntu derivative ships it) and `rsvg-convert` (`apt install librsvg2-bin`). Install with `sudo dpkg -i dist/librenotebook_*.deb`. Reverse-deps the package declares: `ca-certificates`, `libgtk-3-0`, `libwebkit2gtk-4.1-0 | libwebkit2gtk-4.0-37`. `Recommends: yt-dlp` so apt nudges users to install it.

### AppImage

```bash
deno task build:appimage
# → dist/LibreNotebook-<version>-x86_64.AppImage
```

Downloads `appimagetool` to `dist/appimagetool` on first run. On systems without FUSE 2 the script auto-passes `--appimage-extract-and-run`. Make the output executable and run:

```bash
chmod +x dist/LibreNotebook-*.AppImage
./dist/LibreNotebook-*-x86_64.AppImage window     # desktop
./dist/LibreNotebook-*-x86_64.AppImage server     # headless
```

### AppDir only (no packaging)

```bash
deno task compile
# → dist/AppDir/usr/bin/{librenotebook, librenotebook-server, librenotebook-window}
```

Useful for poking at the unpackaged layout. Run `dist/AppDir/AppRun server` or `…/AppRun window` to exercise it directly.

---

## Tests

```bash
deno task test
```

Three Puppeteer specs (`tests/01_onboarding.test.ts`, `tests/02_notebooks.test.ts`, `tests/03_chat.test.ts`) drive the dev server in headless Chromium. They spin the server up automatically; set `BASE_URL=http://localhost:5173` to reuse a running one. They mock the LLM / yt-dlp / settings APIs via `page.setRequestInterception` so no real provider is hit.

---

## Logging

`src/lib/logger.ts` wraps Deno's [`@std/log`](https://jsr.io/@std/log) with two handlers:

- Coloured console at `$LOG_LEVEL` (default `INFO`)
- Rotating file at `.data/librenotebook.log` (5 MB × 3 backups) — disable with `LOG_FILE=0`

Log lines look like:

```
14:22:37 INFO  [http        ] POST /api/notebooks/ab/sources 202 18ms
14:22:37 INFO  [webpage     ] Readability extracted {"url":"https://…","chars":12345,"images":3}
14:22:39 INFO  [rag         ] RAG retrieval {"notebookId":"ab","k":4,"sources":["src-1","src-2"]}
```

---

## License

LibreNotebook is released under the **GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later). See [LICENSE.md](./LICENSE.md).
