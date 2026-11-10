const state = { items: [], category: 'all', query: '' };

const list = document.getElementById('list');
const hero = document.getElementById('hero');
const meta = document.getElementById('meta');
const sourcesEl = document.getElementById('sources');

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return day < 30 ? `${day} 天前` : new Date(iso).toLocaleDateString('zh-CN');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tagClass(item) {
  return item.category === '3d' ? 'd3' : item.category;
}

/**
 * 外链兜底：国外源在这台机器上常常打不开（TLS 被重置），
 * 所以每张卡上给一个「搜」按钮，直接拿标题去必应搜，等于绕过原站。
 */
function searchChip(item) {
  return `<span class="search-fallback" data-title="${escapeHtml(item.title)}" role="button" tabindex="0"
           title="打不开原文时，用标题搜一下">搜</span>`;
}

/** 头条：优先选「有封面图」的最新一条，都没有就退回最新一条。 */
function pickHero(items) {
  return items.find((i) => i.image) ?? items[0] ?? null;
}

function renderHero(item) {
  if (!item) {
    hero.hidden = true;
    return;
  }
  hero.hidden = false;
  hero.href = item.link;
  hero.target = '_blank';
  hero.rel = 'noopener noreferrer';
  hero.innerHTML = `
    ${item.image ? `<div class="hero-bg" style="background-image:url('${encodeURI(item.image)}')"></div>` : ''}
    <div class="hero-inner">
      <div class="hero-eyebrow">
        <span class="tag ${tagClass(item)}">${escapeHtml(item.categoryLabel)}</span>
        <span>${escapeHtml(item.sourceName)}</span>
        <span>·</span>
        <span>${timeAgo(item.publishedAt)}</span>
        ${searchChip(item)}
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
    </div>`;
}

function renderCard(item) {
  const thumb = item.image
    ? `<div class="thumb"><img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"
         onerror="this.parentElement.remove();this.closest('.card').classList.add('text-only')"></div>`
    : '';
  return `
    <a class="card${item.image ? '' : ' text-only'}" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
      ${thumb}
      <div class="body">
        <div class="row">
          <span class="tag ${tagClass(item)}">${escapeHtml(item.categoryLabel)}</span>
          <span>${escapeHtml(item.sourceName)}</span>
          <span>·</span>
          <span>${timeAgo(item.publishedAt)}</span>
          ${searchChip(item)}
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
      </div>
    </a>`;
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.category !== 'all' && item.category !== state.category) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  const visible = visibleItems();
  const featured = pickHero(visible);
  renderHero(featured);

  const rest = featured ? visible.filter((i) => i !== featured) : visible;
  list.innerHTML = rest.length
    ? rest.map(renderCard).join('')
    : '<div class="empty">没有匹配的内容。换个分类或搜索词试试。</div>';
}

function countBy(cat) {
  return cat === 'all'
    ? state.items.length
    : state.items.filter((i) => i.category === cat).length;
}

function setCounts() {
  for (const cat of ['all', 'ai', 'game', '3d']) {
    const el = document.getElementById(`count-${cat}`);
    if (el) el.textContent = countBy(cat);
  }
}

async function boot() {
  try {
    const res = await fetch(`data/items.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.items = data.items ?? [];
    setCounts();
    render();

    const when = new Date(data.generatedAt);
    meta.textContent = `更新于 ${when.toLocaleString('zh-CN', { hour12: false })} · ${data.total ?? state.items.length} 条`;

    const all = data.sources ?? [];
    const failed = all.filter((s) => !s.ok).map((s) => s.name);
    sourcesEl.textContent = failed.length
      ? `${all.length - failed.length}/${all.length} 个来源正常（失败：${failed.join('、')}）`
      : `${all.length} 个来源全部正常`;
  } catch (err) {
    meta.textContent = '数据加载失败';
    list.innerHTML = `<div class="empty">读不到 data/items.json：${escapeHtml(err.message ?? err)}<br>可能是首次抓取还没跑过。</div>`;
  }
}

document.getElementById('filters').addEventListener('click', (event) => {
  const button = event.target.closest('.chip');
  if (!button) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === button));
  state.category = button.dataset.cat;
  render();
});

// 「搜」按钮：拦下卡片本身的跳转，改成开搜索页
function handleSearchFallback(event) {
  const chip = event.target.closest('.search-fallback');
  if (!chip) return;
  event.preventDefault();
  event.stopPropagation();
  const q = chip.dataset.title ?? '';
  window.open(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, '_blank', 'noopener');
}

document.addEventListener('click', handleSearchFallback);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') handleSearchFallback(event);
});

let searchTimer;
document.getElementById('search').addEventListener('input', (event) => {
  clearTimeout(searchTimer);
  const value = event.target.value;
  searchTimer = setTimeout(() => {
    state.query = value;
    render();
  }, 120);
});

boot();
