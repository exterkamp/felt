// Numbers as a readout shows them: a score, a counter, a clock.
//
// Pure, so the same strings come out in node, in a test and on the board -
// and deterministic, which `Intl.NumberFormat` is not across machines (its
// grouping and its minus sign follow the locale, and a readout's width is
// worked out from its characters).

export interface NumberFormat {
  /** Digits after the point. Default 0 (rounded). */
  decimals?: number;
  /** Between each group of three digits. Default ',' - '' for none. */
  group?: string;
  /** The decimal point. Default '.'. */
  point?: string;
  /**
   * `'auto'` (default) writes a minus for negatives only; `'always'` writes
   * a plus too (`+15`, a score change); `'never'` writes neither.
   */
  sign?: 'auto' | 'always' | 'never';
  /** At least this many digits before the point, zero-padded: `007`. */
  pad?: number;
  /** Before and after the number: `'$'`, `' pts'`. */
  prefix?: string;
  suffix?: string;
}

/**
 * A number as text: `formatNumber(12345)` is `'12,345'`,
 * `formatNumber(15, { sign: 'always' })` is `'+15'`,
 * `formatNumber(2.5, { decimals: 2, prefix: '$' })` is `'$2.50'`.
 */
export function formatNumber(value: number, format: NumberFormat = {}): string {
  const { decimals = 0, group = ',', point = '.', sign = 'auto', pad = 0, prefix = '', suffix = '' } = format;
  if (!Number.isFinite(value)) return `${prefix}${value > 0 ? '∞' : value < 0 ? '-∞' : '–'}${suffix}`;
  const fixed = Math.abs(value).toFixed(Math.max(0, Math.min(20, decimals)));
  const [whole, fraction] = fixed.split('.');
  const padded = whole.padStart(pad, '0');
  let grouped = padded;
  if (group) {
    grouped = '';
    for (let i = 0; i < padded.length; i++) {
      if (i > 0 && (padded.length - i) % 3 === 0) grouped += group;
      grouped += padded[i];
    }
  }
  // -0.4 rounds to "0", which is not negative.
  const zero = /^[0.]*$/.test(fixed);
  const mark = sign === 'never' || zero ? '' : value < 0 ? '-' : sign === 'always' ? '+' : '';
  return `${mark}${prefix}${grouped}${fraction !== undefined ? point + fraction : ''}${suffix}`;
}

export interface ClockFormat {
  /** `'auto'` (default) shows hours only from an hour up; `'always'` always. */
  hours?: 'auto' | 'always';
  /** A tenth of a second after the seconds: `01:07.4`. Default false. */
  tenths?: boolean;
  /**
   * How a part second is shown. `'floor'` (default) for time elapsed;
   * `'ceil'` for a countdown, which then reads `00:01` until it is over
   * rather than `00:00` for its last second.
   */
  round?: 'floor' | 'ceil';
  /** Zero-pad the leading unit. Default true: `03:07`, not `3:07`. */
  padLead?: boolean;
}

/** Milliseconds as a clock: `formatClock(187_000)` is `'03:07'`. Negative reads as zero. */
export function formatClock(ms: number, format: ClockFormat = {}): string {
  const { hours = 'auto', tenths = false, round = 'floor', padLead = true } = format;
  const unit = tenths ? 100 : 1000;
  const units = Number.isFinite(ms) ? (round === 'ceil' ? Math.ceil(ms / unit) : Math.floor(ms / unit)) : 0;
  const total = Math.max(0, units);
  const seconds = tenths ? Math.floor(total / 10) : total;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  const tail = tenths ? `.${total % 10}` : '';
  if (h > 0 || hours === 'always') return `${padLead ? two(h) : h}:${two(m)}:${two(s)}${tail}`;
  return `${padLead ? two(m) : m}:${two(s)}${tail}`;
}

/**
 * A colour as `0xrrggbb`, for a tint. Takes a number, `#rgb`, `#rrggbb`
 * (alpha ignored) or `rgb()`; anything else (`'gold'`) needs a browser and
 * is asked of a canvas. Unreadable is white.
 */
export function parseColor(color: string | number | undefined): number {
  if (color === undefined) return 0xffffff;
  if (typeof color === 'number') return color & 0xffffff;
  const text = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map((c) => c + c).join('') : hex.slice(0, 6);
    return Number.parseInt(full, 16);
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb) return (clamp255(rgb[1]) << 16) | (clamp255(rgb[2]) << 8) | clamp255(rgb[3]);
  if (typeof document === 'undefined') return 0xffffff;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return 0xffffff;
  probe.fillStyle = '#ffffff';
  probe.fillStyle = text;
  const read = String(probe.fillStyle);
  return read === text ? 0xffffff : parseColor(read);
}

const clamp255 = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n))));
