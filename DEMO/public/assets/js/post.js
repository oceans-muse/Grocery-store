import {
  api, escapeHtml, compactNumber, padded, formatDate, timeAgo, prefersReducedMotion,
} from './api.js';
import {
  $, $$, bindGlass, initReveal, initHeader, initTheme, initFooter, toast, copyText,
} from './ui.js';

bindGlass();
initTheme();
initHeader();
initFooter();

const slug = decodeURIComponent((location.pathname.match(/^\/post\/([^/]+)\/?$/) || [])[1] || '');
const els = {
  head: $('#articleHead'),
  cover: $('#articleCover'),
  layout: $('.article-layout'),
  body: $('#articleBody'),
  title: $('#articleTitle'),
  excerpt: $('#articleExcerpt'),
  category: $('#articleCategory'),
  date: $('#articleDate'),
  read: $('#articleRead'),
  views: $('#articleViews'),
  likesTop: $('#articleLikesTop'),
  tags: $('#articleTags'),
  end: $('#articleEnd'),
  toc: $('#articleToc'),
  tocNav: $('#tocNav'),
  error: $('#articleError'),
  errorText: $('#articleErrorText'),
  nav: $('#articleNav'),
  comments: $('#comments'),
  related: $('#related'),
  likeButton: $('#likeButton'),
  likeCount: $('#likeCount'),
  likeLabel: $('#likeLabel'),
  breadcrumb: $('#breadcrumbTitle'),
  coverLabel: $('#coverLabel'),
};

let post = null;
let liked = false;
let likePending = false;
let currentShareUrl = location.href;

[els.head, els.cover, els.layout].forEach((el, index) => {
  if (el) el.dataset.reveal = '';
  if (el) el.style.setProperty('--reveal-delay', `${80 + index * 90}ms`);
});

init();

async function init() {
  if (!slug) {
    showError('这个地址里没有有效的手记编号。');
    return;
  }
  try {
    const data = await api(`/posts/${encodeURIComponent(slug)}`);
    post = data.post;
    liked = data.liked;
    currentShareUrl = location.href;
    renderPost(post);
    renderToc(post.toc || []);
    renderAdjacent(data.adjacent);
    renderRelated(data.related || []);
    renderCommentsMeta(post.commentCount || 0);
    renderLike();
    initReveal([els.head, els.cover, els.layout].filter(Boolean));
    initReadingProgress();
    initTocSpy();
    initShare();
    initCodeCopy();
    loadComments();
    bindCommentForm();
    bindLike();
    els.comments.hidden = false;
    els.related.hidden = !data.related?.length;
  } catch (error) {
    if (error.status === 404) showError(error.message);
    else {
      toast(error.message || '文章加载失败。', { type: 'error' });
      showError(error.message || '无法连接到文章服务。');
    }
  }
}

function renderPost(item) {
  document.title = `${item.title} · oceans-muse`;
  const description = item.excerpt || '';
  const canonical = `${location.origin}/post/${encodeURIComponent(item.slug)}`;
  const setMeta = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(selector.startsWith('meta') ? 'content' : 'href', value);
  };
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', `${item.title} · oceans-muse`);
  setMeta('meta[property="og:description"]', description);
  setMeta('link[rel="canonical"]', canonical);
  setMeta('meta[property="og:image"]', `${location.origin}/assets/media/og.svg`);

  els.title.textContent = item.title;
  els.excerpt.textContent = item.excerpt;
  els.category.textContent = item.category;
  els.date.textContent = formatDate(item.publishedAt, 'long');
  els.date.setAttribute('datetime', item.publishedAt || '');
  els.read.textContent = `${item.readingMinutes || 5} min read`;
  els.views.textContent = compactNumber(item.views);
  els.likesTop.textContent = compactNumber(item.likes);
  els.breadcrumb.textContent = item.title;
  els.cover.dataset.cover = item.cover || 'glass';
  els.coverLabel.textContent = `FILE / ${padded(item.id, 3)} · ${item.category}`;

  els.body.innerHTML = item.html || '<p>这篇手记还在总装。</p>';
  els.tags.innerHTML = (item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  els.end.hidden = false;
  els.toc.hidden = !(item.toc || []).length;

  if (item.publishedAt) {
    const machine = document.createElement('meta');
    machine.setAttribute('property', 'article:published_time');
    machine.setAttribute('content', item.publishedAt);
    document.head.append(machine);
  }
}

function renderToc(toc) {
  if (!toc.length) return;
  els.tocNav.innerHTML = toc.map((item) => `
    <a href="#${escapeHtml(item.id)}" data-level="${item.level}">${escapeHtml(item.text)}</a>
  `).join('');
  els.tocNav.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    const target = document.getElementById(link.getAttribute('href').slice(1));
    target?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', link.getAttribute('href'));
  });
}

function renderAdjacent(adjacent) {
  if (!adjacent?.prev && !adjacent?.next) return;
  const prev = $('#prevPost');
  const next = $('#nextPost');
  if (adjacent.prev) {
    prev.href = `/post/${encodeURIComponent(adjacent.prev.slug)}`;
    $('#prevTitle').textContent = adjacent.prev.title;
  } else {
    prev.remove();
  }
  if (adjacent.next) {
    next.href = `/post/${encodeURIComponent(adjacent.next.slug)}`;
    $('#nextTitle').textContent = adjacent.next.title;
  } else {
    next.remove();
  }
  els.nav.hidden = false;
}

function renderRelated(related) {
  const grid = $('#relatedGrid');
  if (!grid) return;
  grid.innerHTML = related.map((item) => `
    <a class="related-card" href="/post/${encodeURIComponent(item.slug)}">
      <span>${escapeHtml(item.category)} · ${formatDate(item.publishedAt)}</span>
      <b>${escapeHtml(item.title)}</b>
      <small>${item.readingMinutes || 5} min</small>
    </a>`).join('');
}

function renderLike() {
  if (!post) return;
  els.likeButton.classList.toggle('is-liked', liked);
  els.likeButton.setAttribute('aria-pressed', String(liked));
  els.likeCount.textContent = compactNumber(post.likes);
  els.likesTop.textContent = compactNumber(post.likes);
  els.likeLabel.textContent = liked ? '已共鸣' : '共鸣';
}

function bindLike() {
  els.likeButton?.addEventListener('click', async () => {
    if (!post || likePending) return;
    likePending = true;
    els.likeButton.disabled = true;
    try {
      const result = await api(`/posts/${encodeURIComponent(post.slug)}/like`, { method: 'POST' });
      liked = result.liked;
      post.likes = result.likes;
      renderLike();
      els.likeButton.classList.remove('is-bumping');
      void els.likeButton.offsetWidth;
      els.likeButton.classList.add('is-bumping');
    } catch (error) {
      toast(error.message || '暂时无法记录共鸣。', { type: 'error' });
    } finally {
      likePending = false;
      els.likeButton.disabled = false;
    }
  });
}

function initShare() {
  $$('[data-share]').forEach((button) => {
    button.addEventListener('click', async () => {
      const shareData = {
        title: post ? `${post.title} · oceans-muse` : document.title,
        text: post?.excerpt || '来自 oceans-muse 的飞行日志',
        url: currentShareUrl,
      };
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share(shareData); return; } catch (error) { if (error.name === 'AbortError') return; }
      }
      const copied = await copyText(currentShareUrl);
      toast(copied ? '链接已复制。' : '复制失败，请从地址栏复制。', { type: copied ? 'success' : 'error' });
    });
  });
}

function initCodeCopy() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
    const copied = await copyText(code);
    const original = button.textContent;
    button.textContent = copied ? '已复制' : '失败';
    window.setTimeout(() => { button.textContent = original; }, 1600);
  });
}

function initReadingProgress() {
  const bar = $('#readingBar');
  if (!bar) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${ratio})`;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

function initTocSpy() {
  const links = $$('a[href^="#"]', els.tocNav);
  if (!links.length || !('IntersectionObserver' in window)) return;
  const headings = links
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (!headings.length) return;
  let activeId = '';
  const setActive = (id) => {
    if (id === activeId) return;
    activeId = id;
    links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`));
  };
  const onScroll = () => {
    const line = window.scrollY + 160;
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top + window.scrollY <= line) current = heading;
    }
    if (current) setActive(current.id);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function renderCommentsMeta(count) {
  const countEl = $('#commentCount');
  if (countEl) countEl.textContent = String(count);
}

let comments = [];
async function loadComments() {
  if (!post) return;
  try {
    const data = await api(`/posts/${encodeURIComponent(post.slug)}/comments`);
    comments = data.comments || [];
    renderComments(comments);
  } catch {
    renderComments([]);
  }
}

function renderComments(items) {
  const list = $('#commentList');
  const count = $('#commentCount');
  if (!list) return;
  if (count) count.textContent = String(items.length);
  if (!items.length) {
    list.innerHTML = '<p class="comment-empty">还没有信号。说点什么，让这条轨道热闹起来。</p>';
    return;
  }
  list.innerHTML = items.map((comment) => `
    <article class="comment">
      <span class="comment__avatar" aria-hidden="true">${escapeHtml((comment.author || '?').slice(0, 1))}</span>
      <div>
        <div class="comment__head">
          <b>${escapeHtml(comment.author)}</b>
          <time datetime="${escapeHtml(comment.createdAt)}" title="${escapeHtml(comment.createdAt)}">${timeAgo(comment.createdAt)}</time>
        </div>
        <p class="comment__body">${escapeHtml(comment.body)}</p>
      </div>
    </article>`).join('');
}

function bindCommentForm() {
  const form = $('#commentForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#commentSubmit');
    const message = $('#commentMessage');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (!button || button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '发送中…';
    message.className = 'form-message';
    message.textContent = '';
    try {
      const data = await api(`/posts/${encodeURIComponent(post.slug)}/comments`, {
        method: 'POST',
        body: {
          author: $('#commentAuthor').value.trim(),
          email: $('#commentEmail').value.trim(),
          body: $('#commentBody').value.trim(),
          website: form.querySelector('[name="website"]')?.value || '',
        },
      });
      message.className = 'form-message is-success';
      message.textContent = data.message || '评论已发布。';
      form.reset();
      toast('信号已送达。');
      loadComments();
    } catch (error) {
      message.className = 'form-message is-error';
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

function showError(message) {
  els.errorText.textContent = message || '它可能已经被移动、回收，或者从未被发射。';
  els.error.hidden = false;
  els.head.hidden = true;
  els.cover.hidden = true;
  els.layout.hidden = true;
  els.end.hidden = true;
  els.nav.hidden = true;
  els.comments.hidden = true;
  els.related.hidden = true;
  document.title = '手记未找到 · oceans-muse';
  els.breadcrumb.textContent = '信号丢失';
}
