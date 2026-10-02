import { useState } from 'preact/hooks';
import { uid } from '../../core/rng';
import type { ClassGroup, Student } from '../../core/types';
import { db } from '../../store/db';
import { Empty, Field, Modal, toast } from '../kit';
import type { Db } from './home';

export function Classes(p: { d: Db; reload: () => void }) {
  const { d } = p;
  const active = d.classes.filter((c) => !c.archived).sort((a, b) => b.createdAt - a.createdAt);
  const [sel, setSel] = useState<string>(active[0]?.id ?? '');
  const [editC, setEditC] = useState<Partial<ClassGroup> | null>(null);
  const [editS, setEditS] = useState<Partial<Student> | null>(null);
  const [bulk, setBulk] = useState(false);
  const cls = d.classes.find((c) => c.id === sel);
  const studs = d.students.filter((s) => s.classId === sel).sort((a, b) => (a.syndicate + a.name).localeCompare(b.syndicate + b.name));
  const saveClass = async () => {
    if (!editC?.name?.trim()) return toast('Class name required.', 'err');
    const c: ClassGroup = { id: editC.id ?? uid('cls'), name: editC.name.trim(), course: editC.course?.trim() ?? '', notes: editC.notes ?? '', createdAt: editC.createdAt ?? Date.now(), archived: editC.archived };
    await db.put('classes', c);
    setEditC(null);
    setSel(c.id);
    p.reload();
  };
  const saveStudent = async () => {
    if (!editS?.name?.trim()) return toast('Name required.', 'err');
    const s: Student = { id: editS.id ?? uid('stu'), classId: sel, rank: editS.rank?.trim() || 'Lt', name: editS.name.trim(), number: editS.number?.trim() ?? '', unit: editS.unit?.trim() ?? '', syndicate: editS.syndicate?.trim() ?? '', pinHash: editS.pinHash, createdAt: editS.createdAt ?? Date.now() };
    await db.put('students', s);
    setEditS(null);
    p.reload();
  };
  return (
    <div class="workspace" style={{ gap: 14, height: 'auto', alignItems: 'flex-start' }}>
      <div class="card" style={{ width: 300, flex: 'none' }}>
        <div class="card-h">
          <h3>Classes</h3>
          <button class="btn small primary right" onClick={() => setEditC({ name: '', course: '' })}>
            + New
          </button>
        </div>
        {active.length ? (
          <div class="col" style={{ gap: 6 }}>
            {active.map((c) => (
              <button class={`btn ${c.id === sel ? 'active' : ''}`} style={{ justifyContent: 'space-between' }} onClick={() => setSel(c.id)}>
                <span>{c.name}</span>
                <span class="dim small">{d.students.filter((s) => s.classId === c.id).length}</span>
              </button>
            ))}
          </div>
        ) : (
          <div class="muted small">No classes yet.</div>
        )}
        {d.classes.some((c) => c.archived) && <div class="dim small" style={{ marginTop: 10 }}>{d.classes.filter((c) => c.archived).length} archived</div>}
      </div>
      <div class="card grow">
        {!cls ? (
          <Empty>Create a class (e.g. "BIC-49 Syn A") to add students.</Empty>
        ) : (
          <>
            <div class="card-h">
              <div>
                <h2 style={{ margin: 0 }}>{cls.name}</h2>
                <div class="muted small">{cls.course}</div>
              </div>
              <div class="right row">
                <button class="btn small" onClick={() => setEditC(cls)}>
                  Edit
                </button>
                <button
                  class="btn small"
                  onClick={async () => {
                    await db.put('classes', { ...cls, archived: true });
                    p.reload();
                  }}
                >
                  Archive
                </button>
                <button class="btn small" onClick={() => setBulk(true)}>
                  Paste list
                </button>
                <button class="btn small primary" onClick={() => setEditS({ rank: 'Lt' })}>
                  + Student
                </button>
              </div>
            </div>
            {studs.length ? (
              <table class="tbl">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>P No</th>
                    <th>Unit</th>
                    <th>Syn</th>
                    <th>Attempts</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {studs.map((s) => {
                    const att = d.attempts.filter((a) => a.studentId === s.id && a.status === 'COMPLETE');
                    return (
                      <tr>
                        <td>{s.rank}</td>
                        <td>
                          <b>{s.name}</b>
                        </td>
                        <td class="mono small">{s.number}</td>
                        <td class="small">{s.unit}</td>
                        <td>{s.syndicate}</td>
                        <td class="small">{att.length ? `${att.length} · avg ${Math.round(att.reduce((m, a) => m + (a.finalPct ?? 0), 0) / att.length)}%` : '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button class="btn small ghost" onClick={() => setEditS(s)}>
                            Edit
                          </button>
                          {s.pinHash && (
                            <button
                              class="btn small ghost"
                              title="Reset PIN"
                              onClick={async () => {
                                await db.put('students', { ...s, pinHash: undefined });
                                toast('PIN reset.', 'ok');
                                p.reload();
                              }}
                            >
                              Reset PIN
                            </button>
                          )}
                          <button
                            class="btn small ghost"
                            onClick={async () => {
                              if (!confirm(`Delete ${s.rank} ${s.name}? Their attempts are kept.`)) return;
                              await db.del('students', s.id);
                              p.reload();
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <Empty>No students. Add them one by one or paste a list.</Empty>
            )}
          </>
        )}
      </div>
      {editC && (
        <Modal
          title={editC.id ? 'Edit class' : 'New class'}
          onClose={() => setEditC(null)}
          footer={
            <button class="btn primary" onClick={saveClass}>
              Save
            </button>
          }
        >
          <div class="col">
            <Field label="Class name">
              <input type="text" value={editC.name ?? ''} placeholder="BIC-49 Syn A" onInput={(e) => setEditC({ ...editC, name: e.currentTarget.value })} />
            </Field>
            <Field label="Course">
              <input type="text" value={editC.course ?? ''} placeholder="Basic Infantry Course 49" onInput={(e) => setEditC({ ...editC, course: e.currentTarget.value })} />
            </Field>
            <Field label="Notes">
              <textarea value={editC.notes ?? ''} onInput={(e) => setEditC({ ...editC, notes: e.currentTarget.value })} />
            </Field>
          </div>
        </Modal>
      )}
      {editS && (
        <Modal
          title={editS.id ? 'Edit student' : 'Add student'}
          onClose={() => setEditS(null)}
          footer={
            <button class="btn primary" onClick={saveStudent}>
              Save
            </button>
          }
        >
          <div class="grid2">
            <Field label="Rank">
              <input type="text" value={editS.rank ?? ''} onInput={(e) => setEditS({ ...editS, rank: e.currentTarget.value })} />
            </Field>
            <Field label="Name">
              <input type="text" value={editS.name ?? ''} onInput={(e) => setEditS({ ...editS, name: e.currentTarget.value })} />
            </Field>
            <Field label="P No / Army No">
              <input type="text" value={editS.number ?? ''} onInput={(e) => setEditS({ ...editS, number: e.currentTarget.value })} />
            </Field>
            <Field label="Unit">
              <input type="text" value={editS.unit ?? ''} onInput={(e) => setEditS({ ...editS, unit: e.currentTarget.value })} />
            </Field>
            <Field label="Syndicate">
              <input type="text" value={editS.syndicate ?? ''} onInput={(e) => setEditS({ ...editS, syndicate: e.currentTarget.value })} />
            </Field>
          </div>
        </Modal>
      )}
      {bulk && cls && <BulkAdd classId={cls.id} onClose={() => setBulk(false)} onDone={() => (setBulk(false), p.reload())} />}
    </div>
  );
}

function BulkAdd(p: { classId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\t|,|;/).map((x) => x.trim()));
  const go = async () => {
    let n = 0;
    for (const r of rows) {
      const [rank, name, number, unit, syn] = r.length === 1 ? ['Lt', r[0]] : r;
      if (!name) continue;
      await db.put('students', { id: uid('stu'), classId: p.classId, rank: rank || 'Lt', name, number: number ?? '', unit: unit ?? '', syndicate: syn ?? '', createdAt: Date.now() });
      n++;
    }
    toast(`${n} students added.`, 'ok');
    p.onDone();
  };
  return (
    <Modal
      title="Paste a student list"
      onClose={p.onClose}
      footer={
        <button class="btn primary" onClick={go} disabled={!rows.length}>
          Add {rows.length} students
        </button>
      }
    >
      <div class="muted small" style={{ marginBottom: 8 }}>
        One per line: <span class="mono">Rank, Name, P No, Unit, Syndicate</span> (comma, semicolon or tab separated — e.g. pasted from Excel). A line with only a name is fine.
      </div>
      <textarea rows={12} value={text} placeholder={'Lt, Hasnain Ali, PA-123456, 139 Baloch, A\n2/Lt, Usman Tariq, PA-123457, 47 Punjab, A'} onInput={(e) => setText(e.currentTarget.value)} />
    </Modal>
  );
}
