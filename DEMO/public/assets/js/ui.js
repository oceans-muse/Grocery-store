import { prefersReducedMotion } from './api.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let toastTimer = 0;

export function toast(message, { type = 'success', duration = 4200 } = {}) {
  const stack = $('#toastStack');
  if (!stack) return;
  const node = document.createElement('div');
  node.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  node.setAttribute('role', 'status');
  node.textContent = message;
  stack.append(node);
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 320);
  }, duration);
}

/** A subtle specular highlight follows the pointer across glass surfaces. */
export function bindGlass() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let active = null;
  const clear = () => {
    if (!active) return;
    active.classList.remove('is-lit');
    active = null;
  };
  document.addEventListener('pointermove', (event) => {
    const glass = event.target.closest?.('.glass');
    if (!glass) {
      clear();
      return;
    }
    if (glass !== active) {
      clear();
      active = glass;
      active.classList.add('is-lit');
    }
    const rect = glass.getBoundingClientRect();
    glass.style.setProperty('--gx', `${(event.clientX - rect.left).toFixed(1)}px`);
    glass.style.setProperty('--gy', `${(event.clientY - rect.top).toFixed(1)}px`);
  }, { passive: true });
  document.addEventListener('pointerleave', clear, { passive: true });
  window.addEventListener('scroll', clear, { passive: true });
}

export function initReveal(nodes = null) {
  const elements = nodes ? [...nodes] : $$('[data-reveal]');
  if (!elements.length) return;
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    elements.forEach((el) => el.classList.add('is-inview'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-inview');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.1, rootMargin: '0px 0px -7% 0px' });
  elements.forEach((el) => observer.observe(el));
}

export function initHeader() {
  const header = $('#siteHeader');
  const progress = $('#scrollProgress');
  const menuToggle = $('#menuToggle');
  const mobileMenu = $('#mobileMenu');
  const navLinks = $$('.nav-link[data-section]');
  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.section))
    .filter(Boolean);

  const setMenu = (open) => {
    if (!menuToggle || !mobileMenu) return;
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    mobileMenu.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('menu-open', open);
    document.body.classList.toggle('is-locked', open);
  };

  menuToggle?.addEventListener('click', () => {
    setMenu(menuToggle.getAttribute('aria-expanded') !== 'true');
  });
  mobileMenu?.addEventListener('click', (event) => {
    if (event.target.closest('a, button')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuToggle?.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menuToggle.focus();
    }
  });
  const desktop = window.matchMedia('(min-width: 921px)');
  desktop.addEventListener?.('change', (event) => { if (event.matches) setMenu(false); });

  let ticking = false;
  const update = () => {
    ticking = false;
    const y = window.scrollY || 0;
    header?.classList.toggle('is-scrolled', y > 18);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;

    let active = null;
    for (const section of sections) {
      if (section.offsetTop - 180 <= y) active = section.id;
    }
    for (const link of navLinks) {
      const isActive = link.dataset.section === active;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
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

export function initTilt() {
  if (prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  $$('[data-tilt]').forEach((element) => {
    let frame = 0;
    element.addEventListener('pointermove', (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        element.style.setProperty('--rx', `${(-y * 3.4).toFixed(2)}deg`);
        element.style.setProperty('--ry', `${(x * 4.2).toFixed(2)}deg`);
      });
    }, { passive: true });
    element.addEventListener('pointerleave', () => {
      element.style.setProperty('--rx', '0deg');
      element.style.setProperty('--ry', '0deg');
    }, { passive: true });
  });
}

export function initTheme() {
  const buttons = $$('#themeToggle, [data-theme-toggle]');
  if (!buttons.length) return;
  const applyLabel = () => {
    const light = document.documentElement.dataset.theme === 'light';
    buttons.forEach((button) => {
      button.setAttribute('aria-label', light ? '切换到深色主题' : '切换到浅色主题');
      button.title = light ? '切换到深色主题' : '切换到浅色主题';
    });
  };
  const paint = (theme) => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('om-theme', theme); } catch { /* storage may be disabled */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'light' ? '#eef0f5' : '#050508');
    applyLabel();
    window.dispatchEvent(new CustomEvent('om:themechange', { detail: { theme } }));
  };
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      if (document.startViewTransition && !prefersReducedMotion()) {
        document.startViewTransition(() => paint(next));
      } else {
        paint(next);
      }
    });
  });
  applyLabel();
}

export function initDialogs() {
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  $$('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  $$('[data-open-contact]').forEach((button) => {
    button.addEventListener('click', () => {
      const dialog = $('#contactDialog');
      if (dialog && !dialog.open) dialog.showModal();
    });
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

export function initFooter() {
  const year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
  $$('[data-current-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
}

export function clearToastTimer() {
  clearTimeout(toastTimer);
  toastTimer = 0;
}
