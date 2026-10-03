// "App & version" card for Data & settings: app version, how WarGamer is running (desktop app,
// installed web app, served page or single file), "Install as app" when the browser offers it,
// and — in the desktop app — classroom hosting on the LAN.
import { useEffect, useState } from 'preact/hooks';
import { APP_VERSION, type LanStatus, desktop, onPwaChange, promptInstall, pwaState } from '../pwa';
import { toast } from './kit';

const MODE_LABEL = { DESKTOP: 'Desktop app', INSTALLED: 'Installed app', SERVED: 'Web (served)', FILE: 'Single file' } as const;

export function AppCard() {
  const [st, setSt] = useState(pwaState());
  const [lan, setLan] = useState<LanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const dt = desktop();
  useEffect(() => onPwaChange(() => setSt(pwaState())), []);
  useEffect(() => {
    dt?.lan
      .status()
      .then(setLan)
      .catch(() => setLan(null));
  }, []);

  const install = async () => {
    if (await promptInstall()) toast('WarGamer installed — open it from your Start menu, dock or desktop.', 'ok');
  };
  const lanAction = async (start: boolean) => {
    if (!dt) return;
    setBusy(true);
    try {
      setLan(await (start ? dt.lan.start() : dt.lan.stop()));
    } catch (e) {
      toast(`Classroom: ${e}`, 'err');
    } finally {
      setBusy(false);
    }
  };
  const studentUrl = lan?.urls?.find((u) => !u.includes('localhost'));

  return (
    <div class="card col wg-app-card">
      <h3>App &amp; version</h3>
      <div class="row wrap">
        <span class="wg-app-ver">WarGamer v{APP_VERSION}</span>
        <span class={`badge ${st.mode === 'DESKTOP' || st.mode === 'INSTALLED' ? 'b-green' : 'b-grey'}`}>{MODE_LABEL[st.mode]}</span>
        {st.offlineReady && <span class="badge b-blue">Works offline</span>}
      </div>
      {st.updateReady && (
        <div class="row wrap wg-app-note">
          <span>A new version of WarGamer has been downloaded.</span>
          <button class="btn small" onClick={() => location.reload()}>
            ⟳ Reload to update
          </button>
        </div>
      )}

      {st.mode === 'DESKTOP' && dt && (
        <>
          <div class="muted small">
            Electron {dt.electron} · {dt.platform}/{dt.arch}. Data is kept in <span class="mono">{dt.dataDir}</span> and survives app updates.
          </div>
          <div class="row wrap">
            <button class="btn" onClick={() => dt.openDataFolder()}>
              Open data folder
            </button>
            <button class="btn" onClick={() => dt.openGuide()}>
              User guide
            </button>
          </div>
          <h4 style={{ marginTop: 6 }}>Classroom on this computer</h4>
          {lan?.hosting ? (
            <>
              <div class="muted">
                Hosting. Students open <b class="mono">{studentUrl ?? lan.urls?.[0]}</b> in Chrome or Edge on the same network. This window uses the shared classroom database.
              </div>
              <div class="row">
                <button class="btn danger" disabled={busy} onClick={() => lanAction(false)}>
                  Stop hosting
                </button>
              </div>
            </>
          ) : (
            <>
              <div class="muted">Share one class database with every PC on the network — no internet or install needed on student PCs.</div>
              <div class="row">
                <button class="btn olive" disabled={busy} onClick={() => lanAction(true)}>
                  Host classroom on LAN…
                </button>
              </div>
            </>
          )}
        </>
      )}

      {st.mode === 'INSTALLED' && <div class="muted">Running as an installed app. It opens and works without a network connection.</div>}

      {st.mode === 'SERVED' &&
        (st.canInstall ? (
          <>
            <div class="muted">Install WarGamer as an app on this computer: it gets its own window and icon, and still opens without a network (offline it uses the data stored on this PC).</div>
            <div class="row">
              <button class="btn primary" onClick={install}>
                ⤓ Install as app
              </button>
            </div>
          </>
        ) : st.insecure ? (
          <div class="muted small">
            Browsers only offer “Install app” on <span class="mono">https://</span> addresses or on the server PC itself (<span class="mono">http://localhost</span>). Students can keep using WarGamer in the browser.
          </div>
        ) : (
          <div class="muted small">{st.installed ? 'Installed. Open WarGamer from your Start menu, dock or desktop.' : 'To install, use the install icon in the browser’s address bar (Chrome / Edge).'}</div>
        ))}

      {st.mode === 'FILE' && (
        <div class="muted small">
          Running from the single file <span class="mono">WarGamer.html</span>. For an app with its own window, use the desktop installer (Windows, macOS, Linux), or open WarGamer from a classroom server and choose “Install as app”.
        </div>
      )}
    </div>
  );
}
