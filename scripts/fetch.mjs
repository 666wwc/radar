// 行业资讯抓取器 —— 纯 Node，零依赖。
// 由 GitHub Actions 每小时执行一次，产出 data/items.json 提交回仓库。

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const OUT = join(process.cwd(), 'data', 'items.json');
// HTTP 头只能是 latin-1，UA 里不能出现中文。
const UA = 'radar-hub/1.0 (personal RSS aggregator; respects robots.txt and rate limits)';
const TIMEOUT_MS = 20000;
const MAX_PER_CATEGORY = 60;
// 加长摘要：外链打不开时，站内也要能看个大概
const SUMMARY_CHARS = 400;

/** 数据源：只用官方 RSS / Atom，不解析 HTML。 */
const SOURCES = [
  // ---------- AI ----------
  { id: 'openai',      name: 'OpenAI',        category: 'ai',   url: 'https://openai.com/news/rss.xml' },
  { id: 'googleai',    name: 'Google AI',     category: 'ai',   url: 'https://blog.google/technology/ai/rss/' },
  { id: 'huggingface', name: 'Hugging Face',  category: 'ai',   url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'techcrunch-ai', name: 'TechCrunch AI', category: 'ai', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'qbitai',      name: '量子位',        category: 'ai',   url: 'https://www.qbitai.com/feed' },
  { id: 'ifanr',       name: '爱范儿',        category: 'ai',   url: 'https://www.ifanr.com/feed' },
  { id: 'ithome',      name: 'IT之家',        category: 'ai',   url: 'https://www.ithome.com/rss/' },
  // ---------- 游戏 ----------
  { id: 'polygon',     name: 'Polygon',       category: 'game', url: 'https://www.polygon.com/rss/index.xml' },
  { id: 'gamedeveloper', name: 'Game Developer', category: 'game', url: 'https://www.gamedeveloper.com/rss.xml' },
  { id: 'rps',         name: 'Rock Paper Shotgun', category: 'game', url: 'https://www.rockpapershotgun.com/feed' },
  { id: 'gcores',      name: '机核',          category: 'game', url: 'https://www.gcores.com/rss' },
  { id: 'indienova',   name: 'indienova',     category: 'game', url: 'https://indienova.com/feed/' },
  { id: 'chuapp',      name: '触乐',          category: 'game', url: 'https://www.chuapp.com/feed' },
  { id: 'gamelook',    name: 'GameLook',      category: 'game', url: 'http://www.gamelook.com.cn/feed' },
  // ---------- 3D / CG ----------
  { id: '80lv',        name: '80 Level',      category: '3d',   url: 'https://80.lv/feed/' },
  { id: 'blendernation', name: 'BlenderNation', category: '3d', url: 'https://www.blendernation.com/feed/' },
  { id: 'blender',     name: 'Blender',       category: '3d',   url: 'https://www.blender.org/feed/' },
];

const CATEGORY_LABELS = { ai: 'AI', game: '游戏', '3d': '3D / CG' };

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** 取第一个同名标签的文本内容。 */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

function stripHtml(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 从 link 标签里取 href（Atom 用属性，RSS 用文本）。 */
function parseLink(block) {
  const atom = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (atom) return decodeEntities(atom[1]).trim();
  return tag(block, 'link');
}

/**
 * 找一张封面图。优先级：enclosure → media:content/thumbnail → 正文里第一张 <img>。
 * 只接受绝对 http(s) 地址；找不到就返回 null，卡片自动退化成纯文字。
 */
function parseImage(block, rawDescription) {
  const candidates = [];

  const enclosure = block.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
  if (enclosure) candidates.push(enclosure[1]);

  const media = block.match(/<media:(?:content|thumbnail)[^>]*url=["']([^"']+)["']/i);
  if (media) candidates.push(media[1]);

  const img = rawDescription.match(/<img[^>]*\ssrc=["']([^"']+)["']/i);
  if (img) candidates.push(img[1]);

  for (const raw of candidates) {
    const url = decodeEntities(raw).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    // 有些源的 enclosure 是视频，不能用当封面
    if (/\.(mp4|webm|mov|m4v|mp3|m4a)(\?|#|$)/i.test(url)) continue;
    return url;
  }
  return null;
}

/** 同时支持 RSS 2.0（<item>）与 Atom（<entry>）。 */
function parseFeed(xml, source) {
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries = blocks.length
    ? blocks
    : [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);

  const out = [];
  for (const block of entries) {
    const title = stripHtml(tag(block, 'title'));
    const link = parseLink(block);
    if (!title || !link) continue;

    const rawSummary = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content');
    const summary = stripHtml(rawSummary).slice(0, SUMMARY_CHARS);

    const publishedAt =
      parseDate(tag(block, 'pubDate')) ||
      parseDate(tag(block, 'published')) ||
      parseDate(tag(block, 'updated')) ||
      null;

    out.push({
      title,
      link,
      summary,
      image: parseImage(block, rawSummary),
      publishedAt,
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      categoryLabel: CATEGORY_LABELS[source.category] ?? source.category,
    });
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function main() {
  const items = [];
  const report = [];

  for (const source of SOURCES) {
    const started = Date.now();
    try {
      const xml = await fetchText(source.url);
      const parsed = parseFeed(xml, source);
      items.push(...parsed);
      report.push({ id: source.id, name: source.name, ok: true, count: parsed.length, ms: Date.now() - started });
      console.log(`  ok   ${source.name.padEnd(20)} ${String(parsed.length).padStart(3)} 条 (${Date.now() - started}ms)`);
    } catch (err) {
      report.push({ id: source.id, name: source.name, ok: false, error: String(err.message ?? err), ms: Date.now() - started });
      console.warn(`  fail ${source.name.padEnd(20)} ${err.message ?? err}`);
    }
  }

  // 去重（同一链接只留一条），按时间倒序，按分类截断。
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = item.link.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  unique.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  const kept = [];
  const perCategory = {};
  for (const item of unique) {
    perCategory[item.category] = (perCategory[item.category] ?? 0) + 1;
    if (perCategory[item.category] > MAX_PER_CATEGORY) continue;
    kept.push(item);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    total: kept.length,
    categories: Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
      id,
      label,
      count: kept.filter((i) => i.category === id).length,
    })),
    sources: report,
    items: kept,
  };

  const okCount = report.filter((r) => r.ok).length;
  if (okCount === 0) {
    console.error('所有来源都失败，保留上一次的数据，不覆盖。');
    process.exit(1);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`\n汇总：${kept.length} 条，来源 ${okCount}/${report.length} 可用 → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
