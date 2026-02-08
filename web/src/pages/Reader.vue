<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  addBookmark,
  Bookmark,
  Chapter,
  deleteBookmark,
  getManifest,
  getProgress,
  listBookmarks,
  markOpened,
  resourceUrl,
  saveProgress,
} from "../lib/api";

const bookId = new URLSearchParams(location.search).get("id") || "";
const title = ref("Loading...");
const spine = ref<string[]>([]);
const chapters = ref<Chapter[]>([]);
const idx = ref(0);
const currentHref = ref<string>("");

const iframeRef = ref<HTMLIFrameElement | null>(null);
const pageWrapRef = ref<HTMLDivElement | null>(null);
const topBarRef = ref<HTMLDivElement | null>(null);
const error = ref("");
const bookmarks = ref<Bookmark[]>([]);
const pendingScroll = ref<{ x: number; y: number } | null>(null);
const saveTimer = ref<number | null>(null);
const cleanupScroll = ref<(() => void) | null>(null);

// Appearance settings (MVP)
const vertical = ref(true);
const fontSize = ref(110);     // %
const lineLength = ref(663);   // px
const fixedPage = ref(true);
const pageAspect = ref(0.75);  // width / height
const viewportHeight = ref(window.innerHeight);
const autoFitWidth = ref<number | null>(null);

function loadCurrent() {
  const iframe = iframeRef.value;
  if (!iframe) return;
  const href = chapters.value[idx.value]?.href ?? spine.value[idx.value];
  if (!href) return;
  currentHref.value = href;
  iframe.src = resourceUrl(bookId, href);
}

function ensureUserStyle(doc: Document) {
  let style = doc.getElementById("nr-user-style") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "nr-user-style";
    doc.head.appendChild(style);
  }
  return style;
}

function injectAppearance() {
  const iframe = iframeRef.value;
  const doc = iframe?.contentDocument;
  if (!doc) return;

  const style = ensureUserStyle(doc);

  // Visual-only: avoid transform/position changes that affect layout
  style.textContent = `
    html { background: #fff; }
    body { color: #121212; margin: 0; padding: 16px; box-sizing: border-box; }
    body { font-size: ${fontSize.value}%; }
    body { max-inline-size: ${lineLength.value}px; }
    ${
      vertical.value
        ? `html,body{ writing-mode: vertical-rl !important; text-orientation: mixed !important; }
           body{ overflow-x:auto; overflow-y:hidden; touch-action: pan-x; }`
        : `body{ overflow-y:auto; overflow-x:hidden; touch-action: pan-y; }`
    }
  `;
}

function axisForDoc(doc: Document): "x" | "y" {
  const wm = getComputedStyle(doc.body).writingMode;
  return wm.startsWith("vertical") ? "x" : "y";
}

// Page-like stepping: one viewport per step (vertical -> x, horizontal -> y)
function stepNext() {
  const doc = iframeRef.value?.contentDocument;
  if (!doc) return;
  const se = doc.scrollingElement as HTMLElement;
  const axis = axisForDoc(doc);
  if (axis === "x") se.scrollBy({ left: se.clientWidth, behavior: "smooth" });
  else se.scrollBy({ top: se.clientHeight, behavior: "smooth" });
}
function stepPrev() {
  const doc = iframeRef.value?.contentDocument;
  if (!doc) return;
  const se = doc.scrollingElement as HTMLElement;
  const axis = axisForDoc(doc);
  if (axis === "x") se.scrollBy({ left: -se.clientWidth, behavior: "smooth" });
  else se.scrollBy({ top: -se.clientHeight, behavior: "smooth" });
}

function nextChapter() {
  idx.value = Math.min(spine.value.length - 1, idx.value + 1);
  loadCurrent();
}
function prevChapter() {
  idx.value = Math.max(0, idx.value - 1);
  loadCurrent();
}

function onLoad() {
  injectAppearance();
  requestAnimationFrame(() => updateLayout());

  const doc = iframeRef.value?.contentDocument;
  const se = getScrollEl(doc);
  if (doc && se) {
    if (cleanupScroll.value) cleanupScroll.value();
    const onScroll = () => {
      if (!currentHref.value) return;
      scheduleSaveProgress(currentHref.value, se.scrollLeft, se.scrollTop);
    };
    se.addEventListener("scroll", onScroll, { passive: true });
    cleanupScroll.value = () => se.removeEventListener("scroll", onScroll);

    doc.addEventListener(
      "wheel",
      (e) => {
        if (!vertical.value) return;
        if (e.deltaY === 0) return;
        e.preventDefault();
        se.scrollBy({ left: e.deltaY, behavior: "auto" });
      },
      { passive: false }
    );

    if (pendingScroll.value) {
      se.scrollLeft = pendingScroll.value.x;
      se.scrollTop = pendingScroll.value.y;
      pendingScroll.value = null;
    }
    // ensure progress updates after layout/scroll settle
  }
}

watch([vertical, fontSize, lineLength, pageAspect, viewportHeight], () => injectAppearance());
watch([pageAspect, fixedPage], () => updateLayout());

function goLibrary() {
  window.location.href = "/";
}

function scheduleSaveProgress(href: string, x: number, y: number) {
  if (saveTimer.value) window.clearTimeout(saveTimer.value);
  saveTimer.value = window.setTimeout(() => {
    saveProgress(bookId, { href, scrollX: Math.round(x), scrollY: Math.round(y) }).catch(() => {});
  }, 300);
}

function getScrollEl(doc?: Document | null) {
  if (!doc) return null;
  return (doc.scrollingElement || doc.documentElement || doc.body) as HTMLElement | null;
}

function bookmarkTitle() {
  const chapter = chapters.value[idx.value];
  const base = chapter?.title ?? `Chapter ${idx.value + 1}`;
  const doc = iframeRef.value?.contentDocument;
  const se = doc?.scrollingElement as HTMLElement | null;
  if (!se) return base;
  const axis = vertical.value ? "x" : "y";
  const pos = axis === "x" ? se.scrollLeft : se.scrollTop;
  const size = axis === "x" ? se.scrollWidth : se.scrollHeight;
  const pct = size > 0 ? Math.round((pos / size) * 100) : 0;
  return `${base} · ${pct}%`;
}

async function onAddBookmark() {
  const doc = iframeRef.value?.contentDocument;
  const se = doc?.scrollingElement as HTMLElement | null;
  if (!se || !currentHref.value) return;
  await addBookmark(bookId, {
    href: currentHref.value,
    scrollX: Math.round(se.scrollLeft),
    scrollY: Math.round(se.scrollTop),
    title: bookmarkTitle(),
  });
  bookmarks.value = await listBookmarks(bookId);
}

async function onDeleteBookmark(id: number) {
  await deleteBookmark(bookId, id);
  bookmarks.value = await listBookmarks(bookId);
}

async function onOpenBookmark(b: Bookmark) {
  const base = b.href.split("#")[0];
  const list = chapters.value.length ? chapters.value : spine.value.map((p) => ({ title: p, href: p }));
  const i = list.findIndex((c) => c.href.split("#")[0] === base);
  if (i >= 0) idx.value = i;
  pendingScroll.value = { x: b.scrollX, y: b.scrollY };
  loadCurrent();
}

function desiredPageWidth() {
  return Math.round(pageHeightPx() * pageAspect.value);
}

function updateLayout() {
  const wrap = pageWrapRef.value;
  const iframe = iframeRef.value;
  if (!wrap || !iframe) return;

  const bgWidth = wrap.clientWidth;
  const doc = iframe.contentDocument;
  if (!doc) {
    autoFitWidth.value = null;
    return;
  }
  const se = doc.scrollingElement as HTMLElement | null;
  const scrollW = se?.scrollWidth ?? 0;
  const targetWidth = Math.min(desiredPageWidth(), bgWidth);

  if (scrollW > 0 && scrollW < targetWidth * 0.8) {
    autoFitWidth.value = Math.min(scrollW, targetWidth);
  } else {
    autoFitWidth.value = null;
  }
}

function pageHeightPx() {
  const topH = topBarRef.value?.offsetHeight ?? 0;
  const usable = Math.max(0, viewportHeight.value - topH);
  return Math.round(usable * 0.96);
}

onMounted(async () => {
  if (!bookId) {
    title.value = "Missing book id";
    return;
  }
  try {
    const m = await getManifest(bookId);
    title.value = m.title;
    spine.value = m.spine;
    if (typeof m.vertical === "boolean") vertical.value = m.vertical;
    chapters.value =
      m.chapters && m.chapters.length ? m.chapters : m.spine.map((p, i) => ({ title: `Chapter ${i + 1}`, href: p }));
    const p = await getProgress(bookId);
    await markOpened(bookId);
    bookmarks.value = await listBookmarks(bookId);

    const list = chapters.value.length ? chapters.value : m.spine.map((p) => ({ title: p, href: p }));
    const latestBm = bookmarks.value[0];
    if (latestBm) {
      const base = latestBm.href.split("#")[0];
      const i = list.findIndex((c) => c.href.split("#")[0] === base);
      if (i >= 0) idx.value = i;
      pendingScroll.value = { x: latestBm.scrollX, y: latestBm.scrollY };
    } else if (p) {
      const base = p.href.split("#")[0];
      const i = list.findIndex((c) => c.href.split("#")[0] === base);
      if (i >= 0) idx.value = i;
      pendingScroll.value = { x: p.scrollX, y: p.scrollY };
    }
    loadCurrent();
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    title.value = "Load failed";
  }

  const onResize = () => {
    viewportHeight.value = window.innerHeight;
    updateLayout();
  };
  window.addEventListener("resize", onResize);

  // Keyboard: left/right for page-step, up/down for chapter
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") stepNext();
    if (e.key === "ArrowLeft") stepPrev();
    if (e.key === "ArrowDown") nextChapter();
    if (e.key === "ArrowUp") prevChapter();
  });
});
</script>

<template>
  <div style="display:flex;height:100vh;font-family:system-ui;">
    <aside style="width:280px;border-right:1px solid #ddd;overflow:auto;padding:12px;box-sizing:border-box;">
      <div style="font-weight:700;margin-bottom:8px;">{{ title }}</div>

      <div style="border-top:1px solid #eee;margin:12px 0;"></div>

      <div style="font-weight:600;margin-bottom:6px;">Appearance</div>
      <label><input type="checkbox" v-model="fixedPage" /> Fixed page</label>
      <label><input type="checkbox" v-model="vertical" /> Vertical</label>
      <div style="margin-top:8px;">
        Font size {{ fontSize }}%
        <input type="range" min="80" max="140" v-model.number="fontSize" />
      </div>
      <div style="margin-top:8px;">
        Line width {{ lineLength }}px
        <input type="range" min="420" max="900" v-model.number="lineLength" />
      </div>
      <div v-if="fixedPage" style="margin-top:8px;">
        Aspect ratio {{ pageAspect.toFixed(2) }}
        <input type="range" min="0.55" max="0.95" step="0.01" v-model.number="pageAspect" />
      </div>
      <!-- <div v-if="fixedPage" style="margin-top:8px;opacity:0.7;">
        Page height = (viewport - top bar) × 96%
      </div> -->

      <div style="border-top:1px solid #eee;margin:12px 0;"></div>

      <div style="font-weight:600;margin-bottom:6px;">Chapters</div>
      <button
        v-for="(c,i) in chapters"
        :key="c.href"
        @click="idx=i; loadCurrent()"
        :style="{
          display:'block', width:'100%', textAlign:'left',
          padding:'6px', margin:'0 0 6px',
          border:'1px solid #ddd',
          background: i===idx ? '#f0f6ff' : '#fff',
          cursor:'pointer'
        }"
      >
        {{ i+1 }}. {{ c.title }}
      </button>

      <div style="border-top:1px solid #eee;margin:12px 0;"></div>
      <div style="font-weight:600;margin-bottom:6px;">Bookmarks</div>
      <div v-if="!bookmarks.length" style="opacity:0.7;">No bookmarks</div>
      <div v-else>
        <div
          v-for="b in bookmarks"
          :key="b.id"
          style="display:flex;gap:6px;align-items:center;margin-bottom:6px;"
        >
          <button
            @click="onOpenBookmark(b)"
            :style="{
              flex:1, textAlign:'left', padding:'6px',
              border:'1px solid #ddd', background:'#fff', cursor:'pointer'
            }"
          >
            {{ b.title }}
          </button>
          <button @click="onDeleteBookmark(b.id)">×</button>
        </div>
      </div>
    </aside>

    <main style="flex:1;min-width:0;display:flex;flex-direction:column;">
      <div ref="topBarRef" style="padding:8px;border-bottom:1px solid #ddd;display:flex;gap:8px;align-items:center;">
        <button @click="goLibrary">← Library</button>
        <button @click="stepPrev">← Page</button>
        <button @click="stepNext">Page →</button>
        <button @click="prevChapter">Prev</button>
        <button @click="nextChapter">Next</button>
        <button @click="onAddBookmark">★ Bookmark</button>
        <span style="opacity:0.7;">(Left/Right: page step, Up/Down: chapter)</span>
      </div>

      <div v-if="error" style="padding:8px;color:#b00;white-space:pre-wrap;">{{ error }}</div>
      <div
        ref="pageWrapRef"
        :style="{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#f4efe6',
          height: '100vh'
        }"
      >
        <iframe
          ref="iframeRef"
          @load="onLoad"
          :style="{
            border: '0',
            width: fixedPage ? (autoFitWidth ?? desiredPageWidth()) + 'px' : '100%',
            height: fixedPage ? pageHeightPx() + 'px' : '100%',
            boxShadow: '0 12px 30px rgba(35,25,15,0.18)',
            background: '#fff',
            borderRadius: '8px'
          }"
        ></iframe>
      </div>
    </main>
  </div>
</template>
