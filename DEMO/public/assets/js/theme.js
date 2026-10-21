/* Theme is resolved before first paint. */
(() => {
  try {
    const queryTheme = new URLSearchParams(location.search).get('theme');
    const stored = localStorage.getItem('om-theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initial = queryTheme === 'light' || queryTheme === 'dark'
      ? queryTheme
      : (stored === 'light' || stored === 'dark' ? stored : (prefersLight ? 'light' : 'dark'));
    document.documentElement.dataset.theme = initial;
  } catch {
    document.documentElement.dataset.theme = 'dark';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = document.documentElement.dataset.theme !== 'light';
    meta.setAttribute('content', dark ? '#050508' : '#eef0f5');
  }
  document.documentElement.classList.add('js');
})();
