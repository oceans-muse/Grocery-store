/* Opening lens: short, skippable, and never shown to reduced-motion users. */
const KEY = 'om-boot-seen-v2';

const boot = document.getElementById('liquidBoot');
const html = document.documentElement;
const params = new URLSearchParams(location.search);
const force = params.get('splash') === '1';
const suppress = params.get('splash') === '0';
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const lowData = Boolean(connection?.saveData) || /(?:^|-)2g$/.test(connection?.effectiveType || '');
const skipForData = lowData && !force;

let seen = false;
try { seen = sessionStorage.getItem(KEY) === '1'; } catch { /* private mode */ }

function settle() {
  boot?.remove();
  html.classList.remove('is-booting');
  html.classList.add('is-ready');
  document.body.classList.remove('is-locked');
}

export const bootDone = new Promise((resolve) => {
  if (!boot || reduce || suppress || skipForData || (seen && !force)) {
    settle();
    resolve();
    return;
  }

  html.classList.add('is-booting');
  document.body.classList.add('is-locked');

  let finished = false;
  let timer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    boot.classList.add('is-leaving');
    html.classList.remove('is-booting');
    html.classList.add('is-ready');
    document.body.classList.remove('is-locked');
    window.setTimeout(() => boot.remove(), 1200);
    resolve();
  };

  timer = window.setTimeout(finish, 2680);
  boot.addEventListener('click', finish);
  boot.addEventListener('pointerdown', finish);
  document.addEventListener('keydown', finish, { once: true });
  window.addEventListener('pagehide', () => {
    if (!finished) {
      try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
    }
  }, { once: true });
});
