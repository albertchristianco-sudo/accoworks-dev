// Sunday edition: fallback motion for browsers without CSS scroll timelines.
// Writes --p (0 to 1) for the cover turn, drives the reading progress bar, and
// reveals content with IntersectionObserver. Does nothing under reduced motion
// or when CSS scroll-driven animations are available (CSS handles it there).
const root = document.documentElement;
const reduce = !window.matchMedia || matchMedia('(prefers-reduced-motion: reduce)').matches;
const native = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');

if (!reduce && !native) {
  root.classList.add('fx');

  const cover = document.querySelector('.home .cover');
  const bar = document.querySelector('.progress');
  let ticking = false;

  const frame = () => {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    if (cover) root.style.setProperty('--p', Math.min(1, Math.max(0, y / vh)).toFixed(4));
    if (bar) {
      const max = root.scrollHeight - vh;
      bar.style.transform = `scaleX(${(max > 0 ? Math.min(1, y / max) : 0).toFixed(4)})`;
    }
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(frame);
    }
  };
  if (cover || bar) {
    if (bar) bar.style.display = 'block';
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    frame();
  }

  const targets = document.querySelectorAll('.pull__line, .profile__photo, .brief, .sidebox:not(.coach__done)');
  if ('IntersectionObserver' in window && targets.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    targets.forEach((target) => {
      target.classList.add('rv');
      io.observe(target);
    });
  }
}
