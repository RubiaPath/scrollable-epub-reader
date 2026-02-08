<script setup lang="ts">
import { onMounted, ref } from "vue";
import { deleteBook, importEpub, listBooks, resourceUrl } from "../lib/api";

const error = ref<string>("");
const file = ref<File | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const books = ref<
  {
    id: string;
    title: string;
    createdAt: number;
    chapterCount: number;
    coverHref?: string | null;
    lastOpenedAt?: number | null;
  }[]
>([]);
const loading = ref(false);
const hoverId = ref<string | null>(null);

async function refresh() {
  loading.value = true;
  try {
    books.value = await listBooks();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

async function onImportFile(file: File | null) {
  error.value = "";
  if (!file) return;
  try {
    const r = await importEpub(file);
    location.href = `/reader?id=${encodeURIComponent(r.id)}`;
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

async function onDelete(id: string) {
  if (!confirm("Delete this book?")) return;
  try {
    await deleteBook(id);
    await refresh();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
  }
}

function openBook(id: string) {
  window.location.href = `/reader?id=${encodeURIComponent(id)}`;
}

function coverFor(id: string, coverHref?: string | null) {
  if (!coverHref) return "";
  return resourceUrl(id, coverHref);
}

function onEnter(id: string) {
  hoverId.value = id;
}
function onLeave(id: string) {
  if (hoverId.value === id) hoverId.value = null;
}
function titleStyle(id: string) {
  const active = hoverId.value === id;
  return {
    transform: active ? "translateY(-6px)" : "translateY(6px)",
    opacity: active ? "1" : "0",
  };
}

function formatDelta(ts?: number | null) {
  if (!ts) return "Never opened";
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day > 1 ? "s" : ""} ago`;
}

onMounted(refresh);
</script>

<template>
  <div class="shelf">
    <header class="shelf-head">
      <div>
        <h1>scrollable-epub-reader</h1>
        <p>Import EPUB → unpack → parse → shelf</p>
      </div>
      <div class="import-box">
        <span style="font-size:12px;opacity:0.7;">EPUB only</span>
        <label style="position:relative;overflow:hidden;display:inline-block;">
          <input
            type="file"
            accept=".epub"
            ref="fileInputRef"
            style="position:absolute;left:-9999px;"
            @change="e => file = (e.target as HTMLInputElement).files?.[0] ?? null"
          />
          <button type="button" @click="fileInputRef?.click()">Import</button>
        </label>
        <button @click="onImportFile(file)">Confirm</button>
        <span v-if="file" style="font-size:12px;opacity:0.7;">{{ file.name }}</span>
      </div>
    </header>

    <section class="books">
      <div v-if="loading" class="muted">Loading...</div>
      <div v-else-if="!books.length" class="muted">No books yet</div>
      <div v-else class="grid">
        <article
          v-for="b in books"
          :key="b.id"
          class="book"
          @mouseenter="onEnter(b.id)"
          @mouseleave="onLeave(b.id)"
        >
          <div class="cover" @click="openBook(b.id)">
            <img v-if="b.coverHref" :src="coverFor(b.id, b.coverHref)" alt="" />
            <div v-else class="fallback"></div>
            <div class="title" :style="titleStyle(b.id)">{{ b.title }}</div>
          </div>
          <div class="meta">
            <div class="name">{{ b.title }}</div>
            <div class="sub">{{ b.chapterCount }} chapters · {{ formatDelta(b.lastOpenedAt) }}</div>
          </div>
          <div class="actions">
            <button @click="openBook(b.id)">Open</button>
            <button @click="onDelete(b.id)">Delete</button>
          </div>
        </article>
      </div>
    </section>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.shelf {
  max-width: 1100px;
  margin: 28px auto;
  padding: 0 16px 32px;
  font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Iowan Old Style", serif;
  color: #1f1b16;
}
.shelf-head {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16px;
  border-bottom: 1px solid #eadfce;
}
.shelf-head h1 {
  margin: 0 0 4px;
  font-size: 28px;
  letter-spacing: 0.02em;
}
.shelf-head p {
  margin: 0;
  opacity: 0.7;
  font-size: 14px;
}
.import-box {
  display: flex;
  gap: 8px;
  align-items: center;
}
.books {
  padding-top: 18px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 18px;
}
.book {
  background: #f7f1e8;
  border: 1px solid #eadfce;
  border-radius: 12px;
  padding: 10px;
  box-shadow: 0 6px 18px rgba(36, 24, 12, 0.08);
}
.cover {
  position: relative;
  aspect-ratio: 3 / 4.2;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(135deg, #f1e2c9, #e9d3b0);
  cursor: pointer;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover .fallback {
  width: 100%;
  height: 100%;
  background: linear-gradient(160deg, #ecd7b6, #e4caa3);
}
.title {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(20, 16, 12, 0.72);
  color: #fff;
  font-size: 13px;
  line-height: 1.2;
  transition: transform 240ms ease, opacity 240ms ease;
  pointer-events: none;
}
.meta {
  margin-top: 10px;
}
.name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  font-size: 12px;
  opacity: 0.7;
}
.actions {
  margin-top: 8px;
  display: flex;
  gap: 8px;
}
.muted {
  opacity: 0.6;
}
.error {
  margin-top: 12px;
  color: #b00;
  white-space: pre-wrap;
}
@media (max-width: 720px) {
  .shelf-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
