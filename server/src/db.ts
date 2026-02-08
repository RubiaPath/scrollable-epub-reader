import path from "path";
import Database from "better-sqlite3";

export type ChapterRow = { title: string; href: string };
export type BookRow = {
  id: string;
  title: string;
  opfPath: string;
  createdAt: number;
  coverHref?: string | null;
  lastOpenedAt?: number | null;
};
export type ProgressRow = { bookId: string; href: string; scrollX: number; scrollY: number; updatedAt: number };
export type BookmarkRow = {
  id: number;
  bookId: string;
  href: string;
  scrollX: number;
  scrollY: number;
  title: string;
  createdAt: number;
};

export function initDb(dataDir: string) {
  const dbPath = path.join(dataDir, "books.db");
  const db = new Database(dbPath);

  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      opfPath TEXT NOT NULL,
      coverHref TEXT,
      lastOpenedAt INTEGER,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookId TEXT NOT NULL,
      idx INTEGER NOT NULL,
      title TEXT NOT NULL,
      href TEXT NOT NULL,
      FOREIGN KEY(bookId) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS progress (
      bookId TEXT PRIMARY KEY,
      href TEXT NOT NULL,
      scrollX INTEGER NOT NULL,
      scrollY INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      FOREIGN KEY(bookId) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bookId TEXT NOT NULL,
      href TEXT NOT NULL,
      scrollX INTEGER NOT NULL,
      scrollY INTEGER NOT NULL,
      title TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(bookId) REFERENCES books(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS chapters_book_idx ON chapters(bookId, idx);
    CREATE INDEX IF NOT EXISTS bookmarks_book_idx ON bookmarks(bookId, id);
  `);

  try {
    db.exec(`ALTER TABLE books ADD COLUMN coverHref TEXT`);
  } catch {
    // ignore if already exists
  }
  try {
    db.exec(`ALTER TABLE books ADD COLUMN lastOpenedAt INTEGER`);
  } catch {
    // ignore if already exists
  }

  const insertBook = db.prepare(
    "INSERT INTO books (id, title, opfPath, coverHref, lastOpenedAt, createdAt) VALUES (@id, @title, @opfPath, @coverHref, @lastOpenedAt, @createdAt)"
  );
  const deleteChapters = db.prepare("DELETE FROM chapters WHERE bookId = ?");
  const insertChapter = db.prepare(
    "INSERT INTO chapters (bookId, idx, title, href) VALUES (@bookId, @idx, @title, @href)"
  );
  const upsertProgressStmt = db.prepare(
    `INSERT INTO progress (bookId, href, scrollX, scrollY, updatedAt)
     VALUES (@bookId, @href, @scrollX, @scrollY, @updatedAt)
     ON CONFLICT(bookId) DO UPDATE SET
       href=excluded.href, scrollX=excluded.scrollX, scrollY=excluded.scrollY, updatedAt=excluded.updatedAt`
  );
  const insertBookmark = db.prepare(
    "INSERT INTO bookmarks (bookId, href, scrollX, scrollY, title, createdAt) VALUES (@bookId, @href, @scrollX, @scrollY, @title, @createdAt)"
  );
  const deleteBookmarkStmt = db.prepare("DELETE FROM bookmarks WHERE bookId = ? AND id = ?");

  const upsertTx = db.transaction((book: BookRow, chapters: ChapterRow[]) => {
    db.prepare("DELETE FROM books WHERE id = ?").run(book.id);
    insertBook.run(book);
    deleteChapters.run(book.id);
    chapters.forEach((c, i) => insertChapter.run({ bookId: book.id, idx: i, title: c.title, href: c.href }));
  });

  function upsertBook(book: BookRow, chapters: ChapterRow[]) {
    upsertTx(book, chapters);
  }

  function listBooks() {
    return db
      .prepare(
        `SELECT b.id, b.title, b.createdAt, b.coverHref AS coverHref, b.lastOpenedAt AS lastOpenedAt,
                (SELECT COUNT(1) FROM chapters c WHERE c.bookId = b.id) AS chapterCount
         FROM books b
         ORDER BY b.createdAt DESC`
      )
      .all() as {
        id: string;
        title: string;
        createdAt: number;
        chapterCount: number;
        coverHref?: string | null;
        lastOpenedAt?: number | null;
      }[];
  }

  function getBook(id: string) {
    const book = db
      .prepare("SELECT id, title, opfPath, coverHref, lastOpenedAt, createdAt FROM books WHERE id = ?")
      .get(id) as
      | BookRow
      | undefined;
    if (!book) return null;
    const chapters = db
      .prepare("SELECT title, href FROM chapters WHERE bookId = ? ORDER BY idx ASC")
      .all(id) as ChapterRow[];
    return { ...book, chapters };
  }

  function deleteBook(id: string) {
    return db.prepare("DELETE FROM books WHERE id = ?").run(id).changes;
  }

  function markOpened(bookId: string, ts: number) {
    return db.prepare("UPDATE books SET lastOpenedAt = ? WHERE id = ?").run(ts, bookId).changes;
  }

  function upsertProgress(p: ProgressRow) {
    upsertProgressStmt.run(p);
  }

  function getProgress(bookId: string) {
    return db
      .prepare("SELECT bookId, href, scrollX, scrollY, updatedAt FROM progress WHERE bookId = ?")
      .get(bookId) as ProgressRow | undefined;
  }

  function addBookmark(b: Omit<BookmarkRow, "id">) {
    const info = insertBookmark.run(b);
    return Number(info.lastInsertRowid);
  }

  function listBookmarks(bookId: string) {
    return db
      .prepare("SELECT id, bookId, href, scrollX, scrollY, title, createdAt FROM bookmarks WHERE bookId = ? ORDER BY id DESC")
      .all(bookId) as BookmarkRow[];
  }

  function deleteBookmark(bookId: string, id: number) {
    return deleteBookmarkStmt.run(bookId, id).changes;
  }

  return {
    upsertBook,
    listBooks,
    getBook,
    deleteBook,
    upsertProgress,
    getProgress,
    addBookmark,
    listBookmarks,
    deleteBookmark,
    markOpened,
  };
}
