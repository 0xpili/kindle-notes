// Kindle Notes UI. Plain JS, no build step. All text is inserted with textContent
// (never innerHTML) so book content can't inject markup.

const $ = (sel) => document.querySelector(sel);

/** Create an element: h('div', { class: 'x', onclick }, child, 'text', ...) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(path) {
  const res = await fetch(path);
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

const state = { books: [], kinds: '' };

// ---------- formatting ----------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null);
const where = (a) => (a.page ? `Page ${a.page}` : a.location != null ? `${a.source === 'reader' ? '≈ ' : ''}Location ${a.location}` : null);

/** Text with search terms wrapped in <mark>, built from text nodes only. */
function withMarks(text, terms) {
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark', {}, part) : part));
}

function plainText(a) {
  const parts = [a.kind === 'bookmark' ? `Bookmark near: ${a.text}` : a.text];
  if (a.note) parts.push(`Note: ${a.note}`);
  parts.push(`— ${a.bookTitle}${a.bookAuthor ? `, ${a.bookAuthor}` : ''}${where(a) ? ` (${where(a)})` : ''}`);
  return parts.join('\n');
}

function card(a, { showBook = false, terms = [] } = {}) {
  const copyBtn = h('button', {
    class: 'copy', type: 'button', title: 'Copy',
    onclick: async (e) => {
      await navigator.clipboard.writeText(plainText(a));
      e.currentTarget.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
    },
  }, 'Copy');

  const quote =
    a.kind === 'bookmark'
      ? h('p', { class: 'quote' }, '🔖 ', a.text ? withMarks(`${a.text}…`, terms) : 'Bookmark')
      : h('p', { class: 'quote' }, withMarks(a.text, terms));

  return h('li', { class: `card k-${a.kind} ${a.color ? 'c-' + a.color : ''} ${a.deleted ? 'deleted' : ''}` },
    quote,
    a.note ? h('p', { class: 'note' }, withMarks(a.note, terms)) : null,
    h('div', { class: 'meta' },
      showBook ? h('a', { href: `#book=${encodeURIComponent(a.asin)}` }, a.bookTitle) : null,
      a.kind !== 'highlight' ? h('span', { class: 'badge' }, a.kind) : null,
      where(a) ? h('span', {}, where(a)) : null,
      fmtDate(a.createdAt) ? h('span', {}, fmtDate(a.createdAt)) : null,
      a.isPartial ? h('span', { class: 'badge warn', title: 'Amazon only shares part of this highlight (publisher export limit)' }, 'partial') : null,
      a.deleted ? h('span', { class: 'badge' }, 'deleted on Amazon') : null,
      copyBtn,
    ),
  );
}

function cover(url, cls = 'cover') {
  return url ? h('img', { class: cls, src: url, alt: '', loading: 'lazy' }) : h('div', { class: cls });
}

function kindChips(onChange) {
  const options = [['', 'All'], ['highlight', 'Highlights'], ['note', 'Notes'], ['bookmark', 'Bookmarks']];
  return h('div', { class: 'chips', role: 'group', 'aria-label': 'Show' },
    options.map(([value, label]) =>
      h('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(state.kinds === value),
        onclick: () => { state.kinds = value; onChange(); },
      }, label)),
  );
}

function empty(...content) {
  return h('div', { class: 'empty' }, ...content);
}

function setView(...nodes) {
  $('#view').replaceChildren(...nodes);
}

function markCurrent(id) {
  document.querySelectorAll('[aria-current]').forEach((el) => el.removeAttribute('aria-current'));
  if (id) document.getElementById(id)?.setAttribute('aria-current', 'page');
}

// ---------- views ----------

function renderBookList() {
  const q = $('#book-filter').value.trim().toLowerCase();
  const items = state.books
    .filter((b) => !q || b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q))
    .map((b) =>
      h('li', {},
        h('a', { class: 'book-item', id: `b-${b.asin}`, href: `#book=${encodeURIComponent(b.asin)}` },
          cover(b.coverUrl),
          h('div', {},
            h('div', { class: 'book-title' }, b.title),
            h('div', { class: 'book-meta' }, [b.highlights && plural(b.highlights, 'highlight'), b.notes && plural(b.notes, 'note'), b.bookmarks && plural(b.bookmarks, 'bookmark')].filter(Boolean).join(' · ')),
          ),
        ),
      ));
  $('#book-list').replaceChildren(...items);
}

async function showBook(asin) {
  markCurrent(`b-${asin}`);
  const book = state.books.find((b) => b.asin === asin);
  if (!book) return setView(empty('Book not found.'));
  const load = async () => {
    const qs = new URLSearchParams({ asin, ...(state.kinds ? { kinds: state.kinds } : {}) });
    const { rows } = await api(`/api/book?${qs}`);
    setView(
      h('div', { class: 'book-head' },
        cover(book.coverUrl, 'cover lg'),
        h('div', {},
          h('h1', {}, book.title),
          book.author ? h('p', { class: 'author' }, book.author) : null,
          h('p', { class: 'book-meta' }, [plural(book.highlights, 'highlight'), plural(book.notes, 'note'), plural(book.bookmarks, 'bookmark')].join(' · ')),
        ),
      ),
      kindChips(load),
      rows.length ? h('ul', { class: 'cards' }, rows.map((a) => card(a))) : empty('Nothing of this kind in this book.'),
    );
  };
  await load();
}

async function showSearch(q) {
  markCurrent(null);
  $('#search').value = q;
  const terms = q.split(/\s+/).filter(Boolean);
  const load = async () => {
    const qs = new URLSearchParams({ q, ...(state.kinds ? { kinds: state.kinds } : {}) });
    const rows = await api(`/api/search?${qs}`);
    setView(
      h('h1', { class: 'page-title' }, `${rows.length}${rows.length === 100 ? '+' : ''} result${rows.length === 1 ? '' : 's'} for “${q}”`),
      kindChips(load),
      rows.length ? h('ul', { class: 'cards' }, rows.map((a) => card(a, { showBook: true, terms }))) : empty('No matches. Try fewer or shorter words.'),
    );
  };
  await load();
}

async function showRecent() {
  markCurrent('nav-recent');
  const load = async () => {
    const rows = await api(`/api/recent${state.kinds ? `?kinds=${state.kinds}` : ''}`);
    setView(
      h('h1', { class: 'page-title' }, 'Recent'),
      kindChips(load),
      rows.length ? h('ul', { class: 'cards' }, rows.map((a) => card(a, { showBook: true }))) : empty('Nothing yet.'),
    );
  };
  await load();
}

async function showRandom() {
  const params = new URLSearchParams(location.hash.slice(1));
  const asin = params.get('book');
  const a = await api(`/api/random${asin ? `?asin=${encodeURIComponent(asin)}` : ''}`);
  const box = $('#random-card');
  if (!a) return;
  box.replaceChildren(
    h('div', { class: 'label' }, asin ? 'Random from this book' : 'Random highlight',
      h('button', { type: 'button', onclick: () => (box.hidden = true), 'aria-label': 'Close' }, '✕')),
    h('ul', { class: 'cards' }, card(a, { showBook: true })),
  );
  box.hidden = false;
  $('#main').scrollTo({ top: 0, behavior: 'smooth' });
}

async function route() {
  state.kinds = '';
  $('#random-card').hidden = true;
  const params = new URLSearchParams(location.hash.slice(1));
  try {
    if (params.get('book')) await showBook(params.get('book'));
    else if (params.get('q')) await showSearch(params.get('q'));
    else await showRecent();
  } catch (err) {
    setView(empty(err.message));
  }
}

async function loadStatus() {
  const s = await api('/api/status');
  const last = s.lastSync ? `Last synced ${new Date(s.lastSync.startedAt).toLocaleString()}${s.lastSync.status !== 'ok' ? ` (${s.lastSync.status})` : ''}` : 'Never synced';
  $('#status').textContent = `${[plural(s.books, 'book'), plural(s.highlights, 'highlight'), plural(s.notes, 'note'), plural(s.bookmarks, 'bookmark')].join(' · ')} — ${last}`;
}

async function init() {
  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#search').value.trim();
    location.hash = q ? `q=${encodeURIComponent(q)}` : 'recent';
  });
  $('#book-filter').addEventListener('input', renderBookList);
  $('#random-btn').addEventListener('click', () => showRandom().catch((e) => setView(empty(e.message))));
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      $('#search').focus();
    }
  });

  try {
    state.books = await api('/api/books');
    renderBookList();
    await loadStatus();
    await route();
  } catch (err) {
    setView(err.status === 503
      ? empty('There is no data. In a terminal, run ', h('code', {}, 'kindle-notes login'), '. Then run ', h('code', {}, 'kindle-notes sync'), '. Then open this page again.')
      : empty(err.message));
  }
}

init();
