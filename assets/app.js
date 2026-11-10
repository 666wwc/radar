const state = { items: [], category: 'all', query: '' };

const list = document.getElementById('list');
const meta = document.getElementById('meta');
const sourcesEl = document.getElementById('sources');

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${Math.max(min, 1)} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  return day < 30 ? `${day} 天前` : new Date(iso).toLocaleDateString('zh-CN');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function card(item) {
  const tagClass = item.category === '3d' ? '3d' : item.category;
  return `
    <a class="card" href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">
      <div class="row">
        <span class="tag ${tagClass}">${escapeHtml(item.categoryLabel)}</span>
        <span>${escapeHtml(item.sourceName)}</span>
        <span>·</span>
        <span>${timeAgo(item.publishedAt)}</span>
      </div>
      <h2>${escapeHtml(item.title)}</h2>
      ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
    </a>`;
}

function render() {
  const q = state.query.trim().toLowerCase();
  const visible = state.items.filter((item) => {
    if (state.category !== 'all' && item.category !== state.category) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    return true;
  });

  list.innerHTML = visible.length
    ? visible.map(card).join('')
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

    const failed = (data.sources ?? []).filter((s) => !s.ok).map((s) => s.name);
    sourcesEl.textContent = failed.length
      ? `${(data.sources ?? []).length - failed.length}/${(data.sources ?? []).length} 个来源正常（失败：${failed.join('、')}）`
      : `${(data.sources ?? []).length} 个来源全部正常`;
  } catch (err) {
    meta.textContent = '数据加载失败';
    list.innerHTML = `<div class="empty">读不到 data/items.json：${escapeHtml(String(err.message ?? err))}<br>可能是首次抓取还没跑过。</div>`;
  }
}

document.getElementById('filters').addEventListener('click', (event) => {
  const button = event.target.closest('.chip');
  if (!button) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === button));
  state.category = button.dataset.cat;
  render();
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
