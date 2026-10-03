// Installable web app (PWA) support and desktop-app detection.
// The service worker and manifest are used only when the page is served over http(s) — by the
// LAN classroom server or any static host. Never on file:// and never inside the desktop app.

export const APP_VERSION: string = __APP_VERSION__;

/** API exposed by electron/preload.cjs (desktop app only). */
export interface DesktopApi {
  isDesktop: true;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  dataDir: string;
  lan: {
    status(): Promise<LanStatus>;
    start(): Promise<LanStatus>;
    stop(): Promise<LanStatus>;
  };
  openDataFolder(): Promise<void>;
  openGuide(): Promise<void>;
}
export interface LanStatus {
  hosting: boolean;
  port?: number;
  urls?: string[];
  dataDir: string;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type AppMode = 'DESKTOP' | 'INSTALLED' | 'SERVED' | 'FILE';

export interface PwaState {
  mode: AppMode;
  /** The browser offered installation (beforeinstallprompt). */
  canInstall: boolean;
  /** The page is served over http(s) but the browser will not allow installation (plain http to a LAN IP). */
  insecure: boolean;
  /** Offline support (service worker) is active. */
  offlineReady: boolean;
  /** A newer version was downloaded; reload to use it. */
  updateReady: boolean;
  installed: boolean;
}

let deferred: InstallPromptEvent | null = null;
let offlineReady = false;
let updateReady = false;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function desktop(): DesktopApi | null {
  const d = typeof window !== 'undefined' ? (window as unknown as { wargamerDesktop?: DesktopApi }).wargamerDesktop : undefined;
  return d?.isDesktop ? d : null;
}

const isElectron = () => !!desktop() || (typeof navigator !== 'undefined' && / Electron\//.test(navigator.userAgent));
const isHttp = () => typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
const standalone = () => typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches);

export function pwaState(): PwaState {
  const mode: AppMode = isElectron() ? 'DESKTOP' : standalone() ? 'INSTALLED' : isHttp() ? 'SERVED' : 'FILE';
  return {
    mode,
    canInstall: !!deferred,
    insecure: isHttp() && typeof isSecureContext !== 'undefined' && !isSecureContext,
    offlineReady,
    updateReady,
    installed,
  };
}

export function onPwaChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Show the browser's install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === 'accepted';
}

/** Call once at start-up. Does nothing on file:// or inside the desktop app. */
export function initPwa(): void {
  if (!isHttp() || isElectron()) return;
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // offer it from Data & settings instead of the mini-infobar
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  const sw = navigator.serviceWorker;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    // First install takes control silently; a later change means a new version is cached.
    if (hadController) {
      updateReady = true;
      emit();
    }
  });
  const register = () =>
    sw
      .register('sw.js', { scope: './' })
      .then(() => sw.ready)
      .then(() => {
        offlineReady = true;
        emit();
      })
      .catch((err) => console.warn('WarGamer: offline support unavailable:', err));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
