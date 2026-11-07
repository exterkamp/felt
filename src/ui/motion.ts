// Whether the person has asked the system for less motion.
//
// Read when it is wanted rather than once, so changing the setting while the
// page is open takes effect at the next readout bump or toast.

/** True when `prefers-reduced-motion: reduce` matches. False outside a browser. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
