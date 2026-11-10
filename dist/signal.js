(() => {
  const button = document.querySelector('#motion');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = preference.matches;
  const render = () => {
    document.documentElement.dataset.motion = paused ? 'off' : 'on';
    button.disabled = preference.matches;
    button.textContent = preference.matches ? 'Reduced motion' : paused ? 'Motion: off' : 'Motion: on';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Enable ambient motion' : 'Pause ambient motion');
  };
  button.hidden = false;
  button.addEventListener('click', () => { paused = !paused; render(); });
  preference.addEventListener('change', e => { paused = e.matches; render(); });
  document.querySelector('#year').textContent = new Date().getFullYear();
  render();
})();
