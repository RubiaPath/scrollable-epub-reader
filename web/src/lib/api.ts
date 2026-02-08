export type Chapter = { title: string; href: string };
export type ImportResult = {
  id: string;
  title: string;
  spine: string[];
  opfPath: string;
  chapters: Chapter[];
  coverHref?: string | null;
  vertical?: boolean;
};
export type BookListItem = {
  id: string;
  title: string;
  createdAt: number;
  chapterCount: number;
  coverHref?: string | null;
  lastOpenedAt?: number | null;
};
export type BookDetail = { id: string; title: string; opfPath: string; createdAt: number; chapters: Chapter[]; coverHref?: string | null };
export type Progress = { bookId: string; href: string; scrollX: number; scrollY: number; updatedAt: number };
export type Bookmark = { id: number; bookId: string; href: string; scrollX: number; scrollY: number; title: string; createdAt: number };

export async function importEpub(file: File): Promise<ImportResult> {
  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch("/api/books/import", { method: "POST", body: fd });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function getManifest(id: string) {
  const r = await fetch(`/api/books/${id}/manifest`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json() as {
    title: string;
    spine: string[];
    opfPath: string;
    chapters?: Chapter[];
    coverHref?: string | null;
    vertical?: boolean;
  };
}

export function resourceUrl(bookId: string, relPath: string) {
  return `/api/books/${bookId}/resource/${relPath}`;
}

export async function getProgress(id: string): Promise<Progress | null> {
  const r = await fetch(`/api/books/${id}/progress`);
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data?.ok ? (data.progress as Progress) : null;
}

export async function saveProgress(id: string, p: Omit<Progress, "bookId" | "updatedAt">): Promise<void> {
  const r = await fetch(`/api/books/${id}/progress`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function listBookmarks(id: string): Promise<Bookmark[]> {
  const r = await fetch(`/api/books/${id}/bookmarks`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function addBookmark(id: string, b: Omit<Bookmark, "id" | "bookId" | "createdAt">): Promise<number> {
  const r = await fetch(`/api/books/${id}/bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
  });
  if (!r.ok) throw new Error(await r.text());
  const data = await r.json();
  return data.id as number;
}

export async function deleteBookmark(id: string, bmId: number): Promise<void> {
  const r = await fetch(`/api/books/${id}/bookmarks/${bmId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function listBooks(): Promise<BookListItem[]> {
  const r = await fetch("/api/books");
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function getBook(id: string): Promise<BookDetail> {
  const r = await fetch(`/api/books/${id}`);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

export async function deleteBook(id: string): Promise<void> {
  const r = await fetch(`/api/books/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export async function markOpened(id: string): Promise<void> {
  const r = await fetch(`/api/books/${id}/opened`, { method: "PUT" });
  if (!r.ok) throw new Error(await r.text());
}
