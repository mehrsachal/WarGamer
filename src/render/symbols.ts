// NATO APP-6 / MIL-STD-2525 unit symbols via milsymbol, cached as canvases.
import ms from 'milsymbol';

export interface SymbolImage {
  canvas: HTMLCanvasElement;
  /** Anchor (symbol centre) in canvas px. */
  ax: number;
  ay: number;
  w: number;
  h: number;
}

const cache = new Map<string, SymbolImage>();

export interface SymOpts {
  size: number;
  label?: string;
  higher?: string;
  planned?: boolean;
  reduced?: boolean;
  dim?: boolean;
  mono?: string;
  info?: boolean;
  direction?: number;
  quantity?: string;
}

export function symbolImage(sidc: string, o: SymOpts): SymbolImage {
  const key = `${sidc}|${Math.round(o.size)}|${o.label ?? ''}|${o.higher ?? ''}|${o.planned ? 1 : 0}|${o.reduced ? 1 : 0}|${o.mono ?? ''}|${o.info === false ? 0 : 1}|${o.direction ?? ''}|${o.quantity ?? ''}`;
  let s = cache.get(key);
  if (s) return s;
  const code = o.planned ? sidc.slice(0, 3) + 'A' + sidc.slice(4) : sidc;
  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const opts: Record<string, unknown> = {
    size: o.size,
    outlineWidth: 3,
    outlineColor: 'rgba(255,255,255,0.92)',
    fontfamily: 'Bahnschrift, Arial Narrow, Arial, sans-serif',
    infoSize: 46,
    infoFields: o.info !== false,
  };
  // milsymbol expects strings for text fields: only pass the ones that are set
  if (o.info !== false && o.label) opts.uniqueDesignation = o.label;
  if (o.info !== false && o.higher) opts.higherFormation = o.higher;
  if (o.reduced) opts.reinforcedReduced = '-';
  if (o.direction !== undefined) opts.direction = o.direction;
  if (o.quantity) opts.quantity = o.quantity;
  if (o.mono) opts.monoColor = o.mono;
  const sym = new ms.Symbol(code, opts as never);
  const canvas = sym.asCanvas(dpr) as HTMLCanvasElement;
  const anchor = sym.getAnchor();
  const size = sym.getSize();
  s = { canvas, ax: anchor.x, ay: anchor.y, w: size.width, h: size.height };
  if (cache.size > 800) cache.clear();
  cache.set(key, s);
  return s;
}

/** Hostile / unknown contact symbol for a fog-of-war picture. */
export function contactSidc(ident: string, size: string, vehicles: number): string {
  const ech: Record<string, string> = { TEAM: 'A', SEC: 'C', PL: 'D', COY: 'E', BN: 'F', BDE: 'H' };
  const e = ech[size] ?? '-';
  if (ident === 'UNKNOWN') return `SUGPU------${e}---`;
  if (ident === 'ARMOUR' || vehicles > 0) return `SHGPUCA----${e}---`;
  if (ident === 'RECCE') return `SHGPUCR----${e}---`;
  if (ident === 'SUPPORT') return `SHGPUCI----${e}---`;
  return `SHGPUCI----${e}---`;
}

/** SVG data URL of a symbol (for palette buttons and reports). */
export function symbolSvg(sidc: string, size = 28, label?: string): string {
  const o: Record<string, unknown> = { size, outlineWidth: 2, outlineColor: 'white' };
  if (label) o.uniqueDesignation = label;
  const sym = new ms.Symbol(sidc, o as never);
  return `data:image/svg+xml;utf8,${encodeURIComponent(sym.asSVG())}`;
}
