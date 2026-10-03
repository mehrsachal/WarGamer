export interface PwaIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}
export declare const PWA_ICONS: PwaIcon[];
export declare function cacheName(version: string, html: string): string;
export declare function manifest(version: string): Record<string, unknown> & { icons: PwaIcon[]; start_url: string; scope: string; display: string; name: string; short_name: string };
export declare function serviceWorker(cache: string): string;
