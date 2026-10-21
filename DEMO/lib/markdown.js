/**
 * A deliberately small, dependency-free Markdown renderer.
 * Raw HTML is always escaped; links are restricted to safe schemes.
 */

const SAFE_URL = /^(?:https?:\/\/|mailto:|\/|#)/i;

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeAttr = (value = '') => escapeHtml(value).replace(/`/g, '&#96;');

function safeUrl(url) {
  const value = String(url || '').trim();
  if (!value || !SAFE_URL.test(value)) return '#';
  return escapeAttr(value);
}

function slugifyHeading(text, used) {
  const base = String(text)
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~!\[\]()]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'section';
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

function inline(source) {
  let text = escapeHtml(source);

  // Code spans are protected before the rest of the inline syntax runs.
  const code = [];
  text = text.replace(/`([^`\n]+)`/g, (_, value) => {
    const token = `\u0000CODE${code.length}\u0000`;
    code.push(`<code>${value}</code>`);
    return token;
  });

  text = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
      const caption = title ? ` title="${escapeAttr(title)}"` : '';
      return `<img src="${safeUrl(src)}" alt="${escapeAttr(alt)}" loading="lazy" decoding="async"${caption}>`;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
      const caption = title ? ` title="${escapeAttr(title)}"` : '';
      const external = /^https?:\/\//i.test(href);
      return `<a href="${safeUrl(href)}"${caption}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\n/g, '<br>');

  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)] || '');
  return text;
}

function isFence(line) {
  return /^(?:```|~~~)/.test(line.trim());
}

function fenceInfo(line) {
  return line.trim().replace(/^(?:```|~~~)/, '').trim().split(/\s+/)[0] || 'text';
}

/**
 * @param {string} markdown
 * @returns {{html: string, toc: Array<{id:string,text:string,level:number}>, minutes: number}}
 */
export function renderMarkdown(markdown = '') {
  const source = String(markdown).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const html = [];
  const toc = [];
  const usedIds = new Set();
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quote = [];
  let codeFence = false;
  let codeLang = 'text';
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join('\n'))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || !listItems.length) {
      listType = null;
      listItems = [];
      return;
    }
    html.push(`<${listType}>${listItems.map((item) => `<li>${inline(item)}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote><p>${inline(quote.join('\n'))}</p></blockquote>`);
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (codeFence) {
      if (isFence(trimmed)) {
        html.push(
          `<figure class="code-block"><figcaption><span>${escapeHtml(codeLang)}</span>` +
          `<button type="button" class="code-copy" data-copy>复制</button></figcaption>` +
          `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></figure>`
        );
        codeFence = false;
        codeLines = [];
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (isFence(trimmed)) {
      flushAll();
      codeFence = true;
      codeLang = fenceInfo(trimmed);
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    const heading = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      const id = slugifyHeading(text, usedIds);
      toc.push({ id, text: text.replace(/[*_~`]/g, ''), level });
      html.push(`<h${level} id="${id}">${inline(text)}<a class="heading-anchor" href="#${id}" aria-label="链接到本节">#</a></h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quote.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      flushAll();
      html.push('<hr>');
      continue;
    }

    if (paragraph.length) flushList();
    paragraph.push(trimmed);
  }

  if (codeFence) {
    html.push(
      `<figure class="code-block"><figcaption><span>${escapeHtml(codeLang)}</span>` +
      `<button type="button" class="code-copy" data-copy>复制</button></figcaption>` +
      `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre></figure>`
    );
  }
  flushAll();

  return { html: html.join('\n'), toc, minutes: readingMinutes(source) };
}

/** Reading time tuned for mixed Chinese/English technical writing. */
export function readingMinutes(markdown = '') {
  const source = String(markdown);
  const chinese = (source.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (source.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(2, Math.round(chinese / 320 + words / 220));
}

export function plainText(markdown = '', max = 220) {
  const text = String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

export { escapeHtml, escapeAttr };
