// Easing curves, by the names Phaser gave them.
//
// The names are kept on purpose: every game this engine replaces Phaser in
// already says 'Cubic.easeOut', and a port that has to rename its eases is a
// port that gets one of them wrong.

export type Ease = (t: number) => number;

const power = (p: number): Record<string, Ease> => ({
  easeIn: (t) => t ** p,
  easeOut: (t) => 1 - (1 - t) ** p,
  easeInOut: (t) => (t < 0.5 ? 2 ** (p - 1) * t ** p : 1 - (-2 * t + 2) ** p / 2),
});

const BACK = 1.70158;

const FAMILIES: Record<string, Record<string, Ease>> = {
  Quad: power(2),
  Cubic: power(3),
  Quart: power(4),
  Quint: power(5),
  Sine: {
    easeIn: (t) => 1 - Math.cos((t * Math.PI) / 2),
    easeOut: (t) => Math.sin((t * Math.PI) / 2),
    easeInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  },
  Expo: {
    easeIn: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
    easeOut: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
    easeInOut: (t) => (t === 0 || t === 1 ? t
      : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  },
  Back: {
    easeIn: (t) => (BACK + 1) * t ** 3 - BACK * t * t,
    easeOut: (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2,
    easeInOut: (t) => {
      const c = BACK * 1.525;
      return t < 0.5
        ? ((2 * t) ** 2 * ((c + 1) * 2 * t - c)) / 2
        : ((2 * t - 2) ** 2 * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
    },
  },
};

const linear: Ease = (t) => t;

/** An ease from its name, or the function itself. Unknown names are linear. */
export function easeOf(ease: string | Ease | undefined): Ease {
  if (typeof ease === 'function') return ease;
  if (!ease || ease === 'Linear' || ease === 'Power0') return linear;
  const [family, kind = 'easeOut'] = ease.split('.');
  // Phaser's aliases: Power1 is Quad, Power2 Cubic, Power3 Quart.
  const alias: Record<string, string> = { Power1: 'Quad', Power2: 'Cubic', Power3: 'Quart' };
  return FAMILIES[alias[family] ?? family]?.[kind] ?? linear;
}
