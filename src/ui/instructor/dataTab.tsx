import { useState } from 'preact/hooks';
import { AiSettingsCard } from '../../ai/ui/AiSettings';
import type { AppSettings } from '../../core/types';
import { hashSecret } from '../../store/auth';
import { type Bundle, db, dbKind, downloadJson, exportBundle, importBundle, pickJsonFile } from '../../store/db';
import { AppCard } from '../appCard';
import { Field, toast } from '../kit';
import { ensureSeed } from '../data';
import type { Db } from './home';

export function DataTab(p: { d: Db; reload: () => void; settings: AppSettings; onSettings: (s: AppSettings) => void }) {
  const { d } = p;
  const [inst, setInst] = useState(p.settings.institution);
  const [name, setName] = useState(p.settings.instructorName);
  const [pw, setPw] = useState('');
  const [packEx, setPackEx] = useState<string[]>([]);
  const stamp = new Date().toISOString().slice(0, 10);
  const doImport = async () => {
    try {
      const b = (await pickJsonFile()) as Bundle;
      const counts = await importBundle(b, { overwriteSettings: false });
      await ensureSeed(); // migrate imported work made on an older preset map frame
      toast(`Imported: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing new'}.`, 'ok');
      p.reload();
    } catch (e) {
      toast(`Import failed: ${e}`, 'err');
    }
  };
  const exportPack = async () => {
    const exs = d.exercises.filter((e) => packEx.includes(e.id));
    if (!exs.length) return toast('Select at least one exercise.', 'err');
    const scen = new Set(exs.map((e) => e.scenarioId));
    const cls = new Set(exs.map((e) => e.classId));
    const b = await exportBundle('PACK', {
      exercises: (e) => packEx.includes(e.id),
      scenarios: (s) => scen.has(s.id),
      classes: (c) => cls.has(c.id),
      students: (s) => cls.has(s.classId),
    });
    downloadJson(`wargamer_pack_${stamp}.json`, b);
  };
  const saveSettings = async () => {
    const st: AppSettings = { ...p.settings, institution: inst.trim() || p.settings.institution, instructorName: name.trim() || p.settings.instructorName, instructorHash: pw ? hashSecret(pw) : p.settings.instructorHash };
    await db.put('settings', st);
    p.onSettings(st);
    setPw('');
    toast('Settings saved.', 'ok');
  };
  return (
    <div class="grid2">
      <div class="card col">
        <h3>Backup &amp; restore</h3>
        <div class="muted">
          Storage: <b>{dbKind() === 'LAN' ? 'shared LAN server' : dbKind() === 'IDB' ? 'this computer’s browser (IndexedDB)' : 'temporary memory — export before closing!'}</b>. Take regular backups.
        </div>
        <div class="row wrap">
          <button class="btn primary" onClick={async () => downloadJson(`wargamer_backup_${stamp}.json`, await exportBundle('BACKUP'))}>
            ⬇ Full backup
          </button>
          <button class="btn" onClick={doImport}>
            ⬆ Import backup / pack / submissions
          </button>
        </div>
        <div class="dim small">Importing merges data; a newer or more complete student attempt always wins.</div>
      </div>
      <div class="card col">
        <h3>Exercise pack for student computers</h3>
        <div class="muted">For machines without the LAN server: export the selected exercises with their scenarios and class rosters, import the file on each student PC, and collect results back as submission files.</div>
        <div class="col" style={{ gap: 2, maxHeight: 200, overflow: 'auto' }}>
          {d.exercises.map((e) => (
            <label class="check">
              <input type="checkbox" checked={packEx.includes(e.id)} onChange={(ev) => setPackEx(ev.currentTarget.checked ? [...packEx, e.id] : packEx.filter((x) => x !== e.id))} />
              {e.title}
            </label>
          ))}
          {!d.exercises.length && <span class="muted small">No exercises yet.</span>}
        </div>
        <button class="btn" onClick={exportPack}>
          ⬇ Export exercise pack
        </button>
      </div>
      <div class="card col">
        <h3>Settings</h3>
        <Field label="Institution">
          <input type="text" value={inst} onInput={(e) => setInst(e.currentTarget.value)} />
        </Field>
        <Field label="Instructor name">
          <input type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="New instructor password (leave blank to keep)">
          <input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
        </Field>
        <button class="btn primary" onClick={saveSettings}>
          Save settings
        </button>
      </div>
      <AiSettingsCard />
      <div class="card col">
        <h3>Classroom network (optional)</h3>
        <div class="muted" style={{ lineHeight: 1.6 }}>
          WarGamer runs fully offline from the single file <span class="mono">WarGamer.html</span>. For a shared class database, run the bundled LAN server on the instructor PC (no internet needed):
          <pre class="mono small" style={{ background: '#0f161c', padding: 10, borderRadius: 8 }}>node server/lan-server.mjs</pre>
          Students then open <span class="mono">http://&lt;instructor-pc&gt;:8080</span> in a browser — all results appear on the instructor’s dashboard live.
        </div>
      </div>
      <AppCard />
      <div class="card col">
        <h3>Danger zone</h3>
        <button
          class="btn danger"
          onClick={async () => {
            if (!confirm('Delete ALL demo attempts?')) return;
            for (const a of d.attempts.filter((x) => x.exerciseId.startsWith('demo_'))) await db.del('attempts', a.id);
            p.reload();
            toast('Demo attempts cleared.', 'ok');
          }}
        >
          Clear demo runs
        </button>
      </div>
    </div>
  );
}
