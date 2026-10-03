// WarGamer desktop app (Electron main process).
// Loads the same single-file app (dist/WarGamer.html) that runs from file://, served from the
// packaged resources over a private app:// scheme so it gets a stable origin: IndexedDB lives
// in the app's userData folder and survives updates. Fully offline; the only network traffic
// is whatever the page itself makes (the optional AI feature) and the optional LAN classroom.
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, protocol, screen, session, shell, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { guidePage } = require('./markdown.cjs');
const { createLanServer } = require('../server/lan-core.cjs');

const SCHEME = 'app';
const HOST = 'wargamer';
const APP_URL = `${SCHEME}://${HOST}/`;
const GUIDE_URL = `${SCHEME}://${HOST}/guide`;
const MIN_W = 1100;
const MIN_H = 700;

app.setName('WarGamer');
if (process.env.WARGAMER_USER_DATA) app.setPath('userData', path.resolve(process.env.WARGAMER_USER_DATA));
if (process.platform === 'win32') app.setAppUserModelId('pk.sit.wargamer');
// Classroom PCs often have old or blocklisted GPUs (or run in VMs): let WebGL (3D map view) fall back
// to Chromium's software renderer instead of being unavailable. The app only renders its own content.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const ROOT = app.getAppPath(); // repo root in development, resources/app.asar when packaged
const DIST = path.join(ROOT, 'dist');
const README = path.join(ROOT, 'README.md');
const ICON = path.join(DIST, 'icons', 'icon-512.png');

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/** @type {BrowserWindow | null} */
let win = null;
/** @type {ReturnType<typeof createLanServer> | null} */
let lan = null;

// ------------------------------------------------------------------ single instance
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(ready);
}

// ------------------------------------------------------------------ app:// protocol
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json' };

function notFound(msg = 'Not found') {
  return new Response(msg, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== HOST) return notFound();
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return notFound();
  }
  if (p === '/guide') {
    let md = '# WarGamer\n\nThe user guide (README.md) is missing from this build.';
    try {
      md = await fs.promises.readFile(README, 'utf8');
    } catch {
      /* keep fallback */
    }
    return new Response(guidePage(md), { headers: { 'Content-Type': MIME['.html'] } });
  }
  const rel = p === '/' || p === '/index.html' ? 'WarGamer.html' : p.slice(1);
  // Only plain file names / icons inside dist — never anything outside it.
  if (!/^(WarGamer\.html|icons\/[A-Za-z0-9_.-]+\.(png|svg))$/.test(rel)) return notFound();
  try {
    const buf = await fs.promises.readFile(path.join(DIST, ...rel.split('/')));
    return new Response(buf, { headers: { 'Content-Type': MIME[path.extname(rel)] ?? 'application/octet-stream' } });
  } catch {
    if (rel === 'WarGamer.html') return notFound('dist/WarGamer.html is missing — run "npm run build" first.');
    return notFound();
  }
}

// ------------------------------------------------------------------ window state
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const w = Math.max(MIN_W, Math.round(s.width));
    const h = Math.max(MIN_H, Math.round(s.height));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    const st = { width: w, height: h, maximized: !!s.maximized, fullscreen: !!s.fullscreen };
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      // Only reuse the position if the window would still be visible on a connected display.
      const visible = screen.getAllDisplays().some(({ workArea: a }) => s.x + 100 < a.x + a.width && s.x + w - 100 > a.x && s.y >= a.y - 10 && s.y + 40 < a.y + a.height);
      if (visible) Object.assign(st, { x: Math.round(s.x), y: Math.round(s.y) });
    }
    return st;
  } catch {
    return null;
  }
}

function trackWindowState(w) {
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    if (w.isDestroyed()) return;
    const b = w.getNormalBounds();
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: w.isMaximized(), fullscreen: w.isFullScreen() }));
    } catch {
      /* not fatal */
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(ev, later);
  w.on('close', save);
}

// ------------------------------------------------------------------ navigation & security
const lanOrigin = () => (lan?.port ? `http://localhost:${lan.port}` : null);

function isAppUrl(u) {
  if (u.startsWith(APP_URL) || u === `${SCHEME}://${HOST}`) return true;
  const o = lanOrigin();
  return !!o && (u === o || u.startsWith(o + '/'));
}

function openExternal(u) {
  if (/^(https?:|mailto:)/i.test(u)) shell.openExternal(u).catch(() => {});
}

function harden(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url === GUIDE_URL || url.startsWith(GUIDE_URL + '#')) {
      openGuide();
      return { action: 'deny' };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    openExternal(url);
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
}

const senderOk = (e) => {
  const u = e.senderFrame?.url ?? '';
  return isAppUrl(u);
};

// ------------------------------------------------------------------ windows
function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    width: st?.width ?? 1600,
    height: st?.height ?? 950,
    x: st?.x,
    y: st?.y,
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    backgroundColor: '#0f1418',
    title: 'WarGamer',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
    },
  });
  if (st?.maximized) win.maximize();
  if (st?.fullscreen) win.setFullScreen(true);
  trackWindowState(win);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });
  win.loadURL(APP_URL);
}

let guideWin = null;
function openGuide() {
  if (guideWin && !guideWin.isDestroyed()) {
    guideWin.focus();
    return;
  }
  guideWin = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 600,
    minHeight: 400,
    title: 'WarGamer — User guide',
    backgroundColor: '#0f1418',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
  });
  guideWin.setMenu(null);
  guideWin.on('closed', () => {
    guideWin = null;
  });
  guideWin.loadURL(GUIDE_URL);
}

function showAbout() {
  const icon = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON).resize({ width: 96, height: 96 }) : undefined;
  dialog.showMessageBox(win ?? undefined, {
    type: 'info',
    icon,
    title: 'About WarGamer',
    message: `WarGamer ${app.getVersion()}`,
    detail: [
      'Offline tactical wargaming trainer — plan, wargame, assess.',
      'Doctrine: The Rifle Company, Platoon and Section in Battle (ICIB).',
      '',
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
      `Data folder: ${app.getPath('userData')}`,
    ].join('\n'),
    buttons: ['OK'],
  });
}

const openDataFolder = () => shell.openPath(app.getPath('userData'));

// ------------------------------------------------------------------ LAN classroom
const classroomDir = () => path.join(app.getPath('userData'), 'classroom');

/** Read the instructor's local IndexedDB data from the app page (app:// origin). */
async function readLocalData() {
  if (!win || !win.webContents.getURL().startsWith(APP_URL)) return {};
  return win.webContents.executeJavaScript(`(async () => {
    if (indexedDB.databases && !(await indexedDB.databases()).some((d) => d.name === 'wargamer')) return {};
    const db = await new Promise((res, rej) => { const r = indexedDB.open('wargamer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    for (const s of Array.from(db.objectStoreNames)) {
      out[s] = await new Promise((res, rej) => { const r = db.transaction(s, 'readonly').objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    }
    db.close();
    return out;
  })()`);
}

function lanStatus() {
  return lan ? { hosting: true, port: lan.port, urls: lan.urls(), dataDir: classroomDir() } : { hosting: false, dataDir: classroomDir() };
}

async function showAddresses() {
  if (!lan) return;
  const urls = lan.urls();
  const student = urls.find((u) => !u.includes('localhost'));
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: 'info',
    title: 'Classroom hosting',
    message: student ? `Students open:  ${student}` : 'No network connection found',
    detail: [
      student ? 'Students on the same network open this address in Chrome or Edge (no install needed). Everything they do is stored in the classroom database on this computer.' : 'Connect this computer to the classroom network (Wi-Fi or LAN cable), then use Classroom → Show classroom addresses.',
      '',
      'All addresses:',
      ...urls.map((u) => `  ${u}`),
      '',
      `Classroom data: ${lan.dataFile}`,
      'If students cannot connect, allow WarGamer through the firewall when Windows asks.',
    ].join('\n'),
    buttons: student ? ['OK', 'Copy student address'] : ['OK'],
    defaultId: 0,
  });
  if (response === 1 && student) clipboard.writeText(student);
}

async function startHosting({ confirm = true } = {}) {
  if (lan) {
    await showAddresses();
    return lanStatus();
  }
  if (confirm) {
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      title: 'Host classroom on LAN',
      message: 'Host a classroom on this computer?',
      detail:
        'Students on the same network can then open WarGamer in a browser and all their work is stored here, on one shared classroom database.\n\n' +
        'Your local classes, students, scenarios and exercises are copied into the classroom database (records already there are kept), and this window switches to the classroom database until you stop hosting.\n\n' +
        'No internet connection is needed.',
      buttons: ['Start hosting', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return lanStatus();
  }
  const srv = createLanServer({ port: 8080, portRetries: 20, dataDir: classroomDir(), distDir: DIST, log: (m) => console.log(m) });
  try {
    await srv.start();
  } catch (e) {
    dialog.showErrorBox('Could not start the classroom server', String(e?.message ?? e));
    return lanStatus();
  }
  lan = srv;
  try {
    const counts = srv.importMissing(await readLocalData());
    if (Object.keys(counts).length) console.log('Copied local data to classroom:', counts);
  } catch (e) {
    console.warn('Could not copy local data to the classroom database:', e);
  }
  buildMenu();
  await win?.loadURL(`${lanOrigin()}/`);
  await showAddresses();
  return lanStatus();
}

async function stopHosting({ confirm = true } = {}) {
  if (!lan) return lanStatus();
  if (confirm) {
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question',
      title: 'Stop hosting',
      message: 'Stop hosting the classroom?',
      detail: `Students will lose their connection. The classroom database is kept (${lan.dataFile}) and is used again the next time you host.\n\nThis window goes back to the data stored locally on this computer. To keep a copy of the class results locally, use Data & settings → Full backup before stopping, then Import afterwards.`,
      buttons: ['Stop hosting', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return lanStatus();
  }
  const srv = lan;
  lan = null;
  await srv.stop();
  buildMenu();
  await win?.loadURL(APP_URL);
  return lanStatus();
}

// ------------------------------------------------------------------ menu
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const hosting = !!lan;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '&File',
      submenu: [{ label: 'Open data folder', click: openDataFolder }, { type: 'separator' }, isMac ? { role: 'close' } : { role: 'quit', label: 'Quit', accelerator: 'Ctrl+Q' }],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: isMac ? 'Ctrl+Command+F' : 'F11' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Classroom',
      submenu: [
        { label: 'Host classroom on LAN…', enabled: !hosting, click: () => startHosting() },
        { label: 'Show classroom addresses…', enabled: hosting, click: () => showAddresses() },
        { label: 'Stop hosting', enabled: hosting, click: () => stopHosting() },
        { type: 'separator' },
        {
          label: 'Open classroom data folder',
          click: () => {
            fs.mkdirSync(classroomDir(), { recursive: true });
            shell.openPath(classroomDir());
          },
        },
      ],
    },
    {
      label: '&Help',
      role: 'help',
      submenu: [{ label: 'User guide', accelerator: 'F1', click: openGuide }, { label: 'Open data folder', click: openDataFolder }, { type: 'separator' }, { label: 'About WarGamer', click: showAbout }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ IPC (exposed by preload.cjs)
function registerIpc() {
  ipcMain.on('wg:info', (e) => {
    e.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      dataDir: app.getPath('userData'),
    };
  });
  const guarded = (fn) => (e, ...a) => (senderOk(e) ? fn(...a) : Promise.reject(new Error('forbidden')));
  ipcMain.handle('wg:lan-status', guarded(async () => lanStatus()));
  ipcMain.handle('wg:lan-start', guarded(async () => startHosting()));
  ipcMain.handle('wg:lan-stop', guarded(async () => stopHosting()));
  ipcMain.handle('wg:open-data', guarded(async () => void (await openDataFolder())));
  ipcMain.handle('wg:open-guide', guarded(async () => openGuide()));
}

// ------------------------------------------------------------------ lifecycle
async function ready() {
  protocol.handle(SCHEME, serveApp);
  // Deny device permissions (camera, mic, geolocation, notifications…); allow only harmless ones.
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  app.on('web-contents-created', (_e, contents) => harden(contents));
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  // Write any pending classroom changes before exit.
  lan?.flush();
});
