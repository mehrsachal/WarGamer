// APP-6 symbols via milsymbol (MIT), cached as canvases. The affiliation character (2nd) follows the side:
// F = friend (own side), H = hostile.
import ms from 'milsymbol';
import type { Side } from '@tht/engine';

const cache = new Map<string, HTMLCanvasElement>();

export function sidcFor(symbol: string, side: Side, viewer: Side): string {
  return symbol.slice(0, 1) + (side === viewer ? 'F' : 'H') + symbol.slice(2);
}

/** Symbol canvas at `size` CSS px (rendered for the device pixel ratio). */
export function symbolCanvas(sidc: string, size: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${sidc}|${Math.round(size)}|${dpr}`;
  let c = cache.get(key);
  if (c) return c;
  const sym = new ms.Symbol(sidc, { size: Math.max(8, size), frame: true, fill: true, outlineWidth: 0, infoFields: false, strokeWidth: 3 } as never);
  c = sym.asCanvas(dpr) as HTMLCanvasElement;
  if (cache.size > 400) cache.clear();
  cache.set(key, c);
  return c;
}

export function symbolDataUrl(sidc: string, size = 28): string {
  const sym = new ms.Symbol(sidc, { size, frame: true, fill: true, infoFields: false } as never);
  return `data:image/svg+xml;utf8,${encodeURIComponent(sym.asSVG())}`;
}
