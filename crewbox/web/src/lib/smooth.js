import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenis;

/** Lenis smooth scroll, driven by GSAP's ticker so ScrollTrigger stays in sync. */
export function startSmoothScroll() {
  if (lenis || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)), smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  const tick = (time) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => { gsap.ticker.remove(tick); lenis.destroy(); lenis = null; };
}

export const scrollTo = (target, opts) => (lenis ? lenis.scrollTo(target, { offset: -20, ...opts }) : document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' }));
// Overlays (panel, dialogs) freeze the page behind them; locks are counted so they can nest.
let locks = 0;
export function lockScroll(on) {
  locks = Math.max(0, locks + (on ? 1 : -1));
  if (lenis) (locks ? lenis.stop() : lenis.start());
  document.documentElement.classList.toggle('scroll-locked', locks > 0);
}
export { gsap, ScrollTrigger };
