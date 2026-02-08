import path from "path";
import fs from "fs/promises";
import fssync from "fs";
import { XMLParser } from "fast-xml-parser";

/** 防止路径穿越 */
export function safeJoin(baseAbs: string, relPath: string) {
  const resolved = path.resolve(baseAbs, relPath);
  if (!resolved.startsWith(baseAbs)) {
    throw new Error("Path traversal blocked");
  }
  return resolved;
}

async function readText(p: string) {
  return await fs.readFile(p, "utf8");
}

/** 通过 META-INF/container.xml 找到 OPF */
export async function findOpfPath(bookRootAbs: string): Promise<string> {
  const containerPath = path.join(bookRootAbs, "META-INF", "container.xml");
  if (!fssync.existsSync(containerPath)) {
    // fallback：直接找 .opf（兼容少数异常包）
    const opfs: string[] = [];
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.toLowerCase().endsWith(".opf")) opfs.push(p);
      }
    }
    await walk(bookRootAbs);
    if (!opfs.length) throw new Error("OPF not found");
    return path.relative(bookRootAbs, opfs[0]).replace(/\\/g, "/");
  }

  const xml = await readText(containerPath);
  const parser = new XMLParser({ ignoreAttributes: false });
  const json = parser.parse(xml);
  const rootfile = json?.container?.rootfiles?.rootfile;
  const fullPath =
    (Array.isArray(rootfile) ? rootfile[0]?.["@_full-path"] : rootfile?.["@_full-path"]) as string | undefined;
  if (!fullPath) throw new Error("OPF full-path not found in container.xml");
  return fullPath.replace(/\\/g, "/");
}

function isString(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

function asText(x: unknown): string | null {
  if (isString(x)) return x;
  if (Array.isArray(x)) return asText(x[0]);
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return asText(o["#text"] ?? o["text"] ?? o["#"] ?? o["_"]);
  }
  if (x == null) return null;
  return String(x);
}

export type BookManifest = {
  title: string;
  opfPath: string;
  spine: string[]; // 相对 bookRoot 的资源路径
  chapters: { title: string; href: string }[];
  coverHref?: string;
  vertical?: boolean;
};

/** 解析 OPF：title + spine（MVP） */
export async function parseOpf(bookRootAbs: string, opfRelPath: string): Promise<BookManifest> {
  const opfAbs = safeJoin(bookRootAbs, opfRelPath);
  const opfXml = await readText(opfAbs);

  const parser = new XMLParser({ ignoreAttributes: false });
  const json = parser.parse(opfXml);

  const metadata = json?.package?.metadata;
  const titleRaw = metadata?.["dc:title"] ?? metadata?.title ?? "Untitled";
  const title = asText(titleRaw) ?? "Untitled";

  const manifestItems = json?.package?.manifest?.item ?? [];
  const spineItems = json?.package?.spine?.itemref ?? [];

  const itemsArr = Array.isArray(manifestItems) ? manifestItems : [manifestItems];
  const spineArr = Array.isArray(spineItems) ? spineItems : [spineItems];

  const manifestMap = new Map<string, { href: string; properties?: string; mediaType?: string }>();
  for (const it of itemsArr) {
    const id = it?.["@_id"];
    const href = it?.["@_href"];
    const properties = it?.["@_properties"];
    const mediaType = it?.["@_media-type"];
    if (isString(id) && isString(href)) manifestMap.set(id, { href, properties, mediaType });
  }

  // OPF 所在目录（spine href 相对这个目录）
  const opfDirRel = path.posix.dirname(opfRelPath);
  const opfDir = opfDirRel === "." ? "" : opfDirRel;
  const resolveHref = (href: string) => (opfDir ? `${opfDir}/${href}` : href).replace(/\\/g, "/");

  const spine = spineArr
    .map((it: any) => it?.["@_idref"])
    .filter(isString)
    .map((idref: string) => manifestMap.get(idref)?.href)
    .filter(isString)
    .map(resolveHref);

  if (!spine.length) {
    throw new Error("Spine is empty (could not resolve itemrefs).");
  }

  let chapters = await extractChapters(bookRootAbs, opfDir, json, manifestMap, spine);
  if (chapters.length < spine.length) {
    chapters = mergeChaptersWithSpine(bookRootAbs, spine, chapters);
  }
  const coverHref = await extractCoverHref(bookRootAbs, opfDir, json, manifestMap, spine);
  const vertical = await detectVertical(bookRootAbs, spine, opfRelPath);

  return { title, opfPath: opfRelPath, spine, chapters, coverHref, vertical };
}

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function extractChapters(
  bookRootAbs: string,
  opfDir: string,
  opfJson: any,
  manifestMap: Map<string, { href: string; properties?: string; mediaType?: string }>,
  spine: string[]
): Promise<{ title: string; href: string }[]> {
  const chapters: { title: string; href: string }[] = [];

  // EPUB2: spine @toc -> NCX
  const tocId = opfJson?.package?.spine?.["@_toc"];
  if (isString(tocId)) {
    const ncx = manifestMap.get(tocId);
    if (ncx?.href) {
      const ncxAbs = safeJoin(bookRootAbs, opfDir ? `${opfDir}/${ncx.href}` : ncx.href);
      if (fssync.existsSync(ncxAbs)) {
        try {
          const ncxXml = await readText(ncxAbs);
          const parser = new XMLParser({ ignoreAttributes: false });
          const ncxJson = parser.parse(ncxXml);
          const navMap = ncxJson?.ncx?.navMap;
          const navPoints = navMap?.navPoint ?? [];
          const arr = Array.isArray(navPoints) ? navPoints : [navPoints];

          const walk = (np: any) => {
            const label = np?.navLabel?.text;
            const src = np?.content?.["@_src"];
            if (isString(label) && isString(src)) {
              chapters.push({ title: String(label), href: (opfDir ? `${opfDir}/${src}` : src).replace(/\\/g, "/") });
            }
            const children = np?.navPoint ?? [];
            const childArr = Array.isArray(children) ? children : [children];
            for (const c of childArr) if (c) walk(c);
          };
          for (const p of arr) if (p) walk(p);
        } catch {
          // ignore ncx parse errors
        }
      }
    }
  }

  if (chapters.length) return chapters;

  // EPUB3: manifest item with properties="nav"
  let navHref: string | undefined;
  for (const v of manifestMap.values()) {
    if (v.properties && v.properties.split(/\s+/).includes("nav")) {
      navHref = v.href;
      break;
    }
  }
  if (navHref) {
    const navAbs = safeJoin(bookRootAbs, opfDir ? `${opfDir}/${navHref}` : navHref);
    if (fssync.existsSync(navAbs)) {
      try {
        const navHtml = await readText(navAbs);
        const navMatch = navHtml.match(
          /<nav[^>]*(?:epub:type|role)=["'](?:toc|doc-toc)["'][^>]*>([\s\S]*?)<\/nav>/i
        );
        const navBlock = navMatch ? navMatch[1] : navHtml;
        const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(navBlock))) {
          const href = m[1];
          const title = stripTags(m[2] || "");
          if (isString(href) && isString(title)) {
            chapters.push({ title, href: (opfDir ? `${opfDir}/${href}` : href).replace(/\\/g, "/") });
          }
        }
      } catch {
        // ignore nav parse errors
      }
    }
  }

  if (chapters.length) return chapters;

  // Fallback: try <title> in each spine document, then filename, then generic
  const out: { title: string; href: string }[] = [];
  for (let i = 0; i < spine.length; i++) {
    const href = spine[i];
    const cleanHref = href.split("#")[0];
    let title: string | null = null;
    try {
      const abs = safeJoin(bookRootAbs, cleanHref);
      const html = await readText(abs);
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) title = stripTags(m[1] || "");
    } catch {
      // ignore read errors
    }
    if (!title) {
      const base = path.posix.basename(cleanHref || href);
      title = base.replace(/\.[^.]+$/, "") || `Chapter ${i + 1}`;
    }
    out.push({ title, href });
  }
  return out;
}

function mergeChaptersWithSpine(
  bookRootAbs: string,
  spine: string[],
  chapters: { title: string; href: string }[]
) {
  const titleMap = new Map<string, string>();
  for (const c of chapters) {
    const base = c.href.split("#")[0];
    if (!titleMap.has(base) && c.title) titleMap.set(base, c.title);
  }

  const merged: { title: string; href: string }[] = [];
  for (let i = 0; i < spine.length; i++) {
    const href = spine[i];
    const base = href.split("#")[0];

    let title = titleMap.get(base) || null;
    if (!title) {
      try {
        const abs = safeJoin(bookRootAbs, base);
        const html = fssync.existsSync(abs) ? fssync.readFileSync(abs, "utf8") : "";
        const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (m) title = stripTags(m[1] || "");
      } catch {
        // ignore
      }
    }
    if (!title) {
      const baseName = path.posix.basename(base || href);
      title = baseName.replace(/\.[^.]+$/, "") || `Chapter ${i + 1}`;
    }
    merged.push({ title, href });
  }

  return merged;
}

async function detectVertical(bookRootAbs: string, spine: string[], opfRelPath: string) {
  const first = spine[0];
  if (!first) return false;
  try {
    const abs = safeJoin(bookRootAbs, first.split("#")[0]);
    const html = await readText(abs);
    if (/writing-mode\s*:\s*vertical/i.test(html)) return true;
    if (/vertical-rl|vertical-lr/i.test(html)) return true;
    // Some fixed-layout books rely on RTL progression
    if (/page-progression-direction\s*=\s*["']rtl["']/i.test(html)) return true;
  } catch {
    // ignore
  }
  // Optional: EPUB package spine page-progression-direction
  try {
    const opfAbs = safeJoin(bookRootAbs, opfRelPath);
    if (fssync.existsSync(opfAbs)) {
      const opfXml = fssync.readFileSync(opfAbs, "utf8");
      if (/page-progression-direction\s*=\s*["']rtl["']/i.test(opfXml)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}
function normalizeHref(opfDir: string, href: string) {
  const p = opfDir ? `${opfDir}/${href}` : href;
  return p.replace(/\\/g, "/");
}

function findCoverIdFromMetadata(metadata: any): string | null {
  const meta = metadata?.meta ?? [];
  const arr = Array.isArray(meta) ? meta : [meta];
  for (const m of arr) {
    const name = m?.["@_name"];
    if (name === "cover") {
      const content = m?.["@_content"];
      if (isString(content)) return content;
    }
  }
  return null;
}

async function extractCoverHref(
  bookRootAbs: string,
  opfDir: string,
  opfJson: any,
  manifestMap: Map<string, { href: string; properties?: string; mediaType?: string }>,
  spine: string[]
): Promise<string | undefined> {
  const metadata = opfJson?.package?.metadata;

  // EPUB2: <meta name="cover" content="cover-image-id" />
  const coverId = findCoverIdFromMetadata(metadata);
  if (coverId) {
    const item = manifestMap.get(coverId);
    if (item?.href) return normalizeHref(opfDir, item.href);
  }

  // EPUB3: manifest item with properties="cover-image"
  for (const v of manifestMap.values()) {
    if (v.properties && v.properties.split(/\s+/).includes("cover-image")) {
      return normalizeHref(opfDir, v.href);
    }
  }

  // Fallback: read first spine doc and grab first image
  if (spine.length) {
    const first = spine[0];
    try {
      const abs = safeJoin(bookRootAbs, first.split("#")[0]);
      const html = await readText(abs);
      let m = html.match(/<img[^>]*src=["']([^"']+)["']/i);
      if (!m) m = html.match(/<image[^>]*(?:xlink:href|href)=["']([^"']+)["']/i);
      if (m && isString(m[1])) {
        return normalizeHref(opfDir, m[1]);
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}
