import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import fssync from "fs";
import cors from "cors";
import extract from "extract-zip";
import { nanoid } from "nanoid";
import mime from "mime";
import { findOpfPath, parseOpf, safeJoin } from "./epub";
import { initDb } from "./db";

const app = express();
app.use(express.json());

// 允许前端 5173 调用（你也可以换成 Vite proxy，就不用 CORS）
app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"], credentials: false }));

const DATA_DIR = path.resolve(process.cwd(), "data");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const BOOKS_DIR = path.join(DATA_DIR, "books");

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(BOOKS_DIR, { recursive: true });
}

const upload = multer({ dest: TMP_DIR });
let db: ReturnType<typeof initDb> | null = null;

async function ensureDb() {
  await ensureDirs();
  if (!db) db = initDb(DATA_DIR);
  return db;
}

app.post("/api/books/import", upload.single("file"), async (req, res) => {
  try {
    const db = await ensureDb();
    if (!req.file) return res.status(400).json({ error: "missing file" });

    const bookId = nanoid();
    const bookRoot = path.join(BOOKS_DIR, bookId);
    await fs.mkdir(bookRoot, { recursive: true });

    // 解包 EPUB（zip）到 bookRoot
    await extract(req.file.path, { dir: bookRoot });
    await fs.unlink(req.file.path).catch(() => {});

    // 找 OPF 并解析
    const opfRel = await findOpfPath(bookRoot);
    const manifest = await parseOpf(bookRoot, opfRel);

    // 保存 manifest.json（MVP）
    await fs.writeFile(path.join(bookRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

    db.upsertBook(
      {
        id: bookId,
        title: manifest.title,
        opfPath: manifest.opfPath,
        coverHref: manifest.coverHref ?? null,
        createdAt: Date.now(),
      },
      manifest.chapters
    );

    res.json({ id: bookId, ...manifest });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.get("/api/books", async (_, res) => {
  try {
    const db = await ensureDb();
    res.json(db.listBooks());
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.get("/api/books/:id", async (req, res) => {
  try {
    const db = await ensureDb();
    const book = db.getBook(req.params.id);
    if (!book) return res.status(404).json({ error: "not found" });
    res.json(book);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.put("/api/books/:id/opened", async (req, res) => {
  try {
    const db = await ensureDb();
    db.markOpened(req.params.id, Date.now());
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.get("/api/books/:id/progress", async (req, res) => {
  try {
    const db = await ensureDb();
    const p = db.getProgress(req.params.id);
    if (!p) return res.json({ ok: false });
    res.json({ ok: true, progress: p });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.put("/api/books/:id/progress", async (req, res) => {
  try {
    const db = await ensureDb();
    const { href, scrollX, scrollY } = req.body ?? {};
    if (!href || typeof scrollX !== "number" || typeof scrollY !== "number") {
      return res.status(400).json({ error: "invalid payload" });
    }
    db.upsertProgress({
      bookId: req.params.id,
      href,
      scrollX,
      scrollY,
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.get("/api/books/:id/bookmarks", async (req, res) => {
  try {
    const db = await ensureDb();
    res.json(db.listBookmarks(req.params.id));
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/books/:id/bookmarks", async (req, res) => {
  try {
    const db = await ensureDb();
    const { href, scrollX, scrollY, title } = req.body ?? {};
    if (!href || typeof scrollX !== "number" || typeof scrollY !== "number" || !title) {
      return res.status(400).json({ error: "invalid payload" });
    }
    const id = db.addBookmark({
      bookId: req.params.id,
      href,
      scrollX,
      scrollY,
      title,
      createdAt: Date.now(),
    });
    res.json({ ok: true, id });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.delete("/api/books/:id/bookmarks/:bmId", async (req, res) => {
  try {
    const db = await ensureDb();
    const changes = db.deleteBookmark(req.params.id, Number(req.params.bmId));
    res.json({ ok: true, changes });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

app.get("/api/books/:id/manifest", async (req, res) => {
  try {
    const bookRoot = path.join(BOOKS_DIR, req.params.id);
    const p = path.join(bookRoot, "manifest.json");
    const txt = await fs.readFile(p, "utf8");
    res.type("application/json").send(txt);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.delete("/api/books/:id", async (req, res) => {
  try {
    const db = await ensureDb();
    const id = req.params.id;
    const bookRoot = path.join(BOOKS_DIR, id);
    db.deleteBook(id);
    await fs.rm(bookRoot, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// 资源访问：/api/books/:id/resource/<relPath>
// Use a RegExp route to capture the rest of the path in Express 5
app.get(/^\/api\/books\/([^/]+)\/resource\/(.*)$/, async (req, res) => {
  try {
    const bookRoot = path.join(BOOKS_DIR, req.params[0]);
    const rel = req.params[1];
    const abs = safeJoin(bookRoot, rel);

    if (!fssync.existsSync(abs)) return res.status(404).send("not found");

    const ct = mime.getType(abs) || "application/octet-stream";
    res.setHeader("Content-Type", ct);

    // 简单流式输出（MVP）。后续要 Range 再加。
    fssync.createReadStream(abs).pipe(res);
  } catch (e: any) {
    res.status(404).json({ error: e?.message ?? "not found" });
  }
});

app.get("/api/health", (_, res) => res.json({ ok: true }));

app.listen(8787, async () => {
  await ensureDirs();
  console.log("server: http://127.0.0.1:8787");
});
