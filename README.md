# scrollable-epub-reader

A minimal local EPUB reader with a bookshelf, chapter list, bookmarks, and reading progress persistence.

一个简洁的本地 EPUB 阅读器，包含书架、章节列表和书签，滚动阅读，支持竖排与固定页面尺寸。

**Features**
1. Import EPUB and extract metadata, spine, chapters, and cover
2. Bookshelf with cover thumbnails, delete, and last opened time
3. Reader with chapter navigation, vertical/horizontal layouts, and fixed page sizing
4. Bookmarks and auto-restore of the last reading position

**Tech Stack**
1. Frontend: Vue 3 + Vite + TypeScript
2. Backend: Node.js + Express 5 + SQLite

**Project Structure**
1. `web/` Frontend app
2. `server/` Backend API and EPUB processing

**Setup**
1. Install dependencies
```bash
cd /Users/unknow/Documents/codes/new-reader/scrollable-epub-reader/server
npm i
cd /Users/unknow/Documents/codes/new-reader/scrollable-epub-reader/web
npm i
```

2. Start backend
```bash
cd /Users/unknow/Documents/codes/new-reader/scrollable-epub-reader/server
npm run dev
```

3. Start frontend
```bash
cd /Users/unknow/Documents/codes/new-reader/scrollable-epub-reader/web
npm run dev
```

**Notes**
1. The backend stores data in `server/data/books.db`.
2. Re-import a book to refresh metadata like chapters or cover detection.

**API Overview**
1. `POST /api/books/import` Import an EPUB
2. `GET /api/books` List books
3. `GET /api/books/:id` Book details
4. `DELETE /api/books/:id` Delete book
5. `GET /api/books/:id/manifest` Manifest (title, spine, chapters)
6. `GET /api/books/:id/progress` Get last reading position
7. `PUT /api/books/:id/progress` Save reading position
8. `GET /api/books/:id/bookmarks` List bookmarks
9. `POST /api/books/:id/bookmarks` Add bookmark
10. `DELETE /api/books/:id/bookmarks/:bmId` Delete bookmark
11. `PUT /api/books/:id/opened` Mark book as opened

**Notes On Existing Electron EPUB Readers**
1. Many Electron-based EPUB readers cannot use Chrome extensions at all.
2. Chrome extensions cannot access sandboxed content.

**Security Discussion**
1. EPUB content is untrusted input; avoid executing arbitrary scripts from book content.
2. This project renders EPUB content inside an `iframe` and serves resources via a local API, which reduces but does not eliminate risk.
3. Avoid exposing the server beyond localhost unless proper auth and content filtering are added.

**Future**
1. Implement true pagination (paged layout), not just scrolling.
2. Support both horizontal and vertical writing modes with accurate page metrics.

**Notes on Readium Pagination**
1. In Readium-based stacks, pagination is controlled by the Navigator (JS), not only CSS.
2. Vertical writing mode flips the reading axis; many implementations still assume vertical scrolling, which breaks pagination metrics.
