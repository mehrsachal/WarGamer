import { useEffect, useState } from 'preact/hooks';
import type { AppSettings, ClassGroup, Student } from '../core/types';
import { hashSecret } from '../store/auth';
import { db } from '../store/db';
import { Field, type Session, toast } from './kit';

function Art() {
  return (
    <div class="login-art">
      <div class="brand" style={{ marginBottom: 26 }}>
        <span class="logo" />
        <span style={{ fontSize: 15 }}>APP-6 · ICIB</span>
      </div>
      <h1>WARGAMER</h1>
      <p>
        Tactical decision trainer for young officers. Read the narrative, appreciate the ground, mark your plan with NATO symbology — then fight it against a
        thinking Foxland enemy under fog of war. Every plan and every decision is marked objectively against doctrine.
      </p>
      <div class="feat">
        <div>🗺 Minor &amp; major ops (Pl → Bde)</div>
        <div>🎲 Unlimited random scenarios</div>
        <div>🌫 Fog of war, arty, QC, UCAV, EW</div>
        <div>📋 Objective DS marking with refs</div>
        <div>👥 Classes, syndicates, results</div>
        <div>🔌 Runs fully offline</div>
      </div>
    </div>
  );
}

export function Setup(p: { onDone: (s: AppSettings) => void }) {
  const [inst, setInst] = useState('School of Infantry & Tactics');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const save = async () => {
    if (pw.length < 4) return toast('Password must be at least 4 characters.', 'err');
    if (pw !== pw2) return toast('Passwords do not match.', 'err');
    const st: AppSettings = { id: 'settings', institution: inst.trim() || 'Training Institution', instructorHash: hashSecret(pw), instructorName: name.trim() || 'Instructor', createdAt: Date.now() };
    await db.put('settings', st);
    toast('Setup complete. Log in as instructor to create classes.', 'ok');
    p.onDone(st);
  };
  return (
    <div class="login-wrap hero">
      <div class="login-card">
        <Art />
        <div class="login-form">
          <h2>First-time setup</h2>
          <p class="muted">Create the instructor account for this installation. Students are added by the instructor.</p>
          <Field label="Institution">
            <input type="text" value={inst} onInput={(e) => setInst(e.currentTarget.value)} />
          </Field>
          <Field label="Instructor name / appointment">
            <input type="text" value={name} placeholder="e.g. Maj Azlaan, DS" onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field label="Instructor password">
            <input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} />
          </Field>
          <Field label="Confirm password">
            <input type="password" value={pw2} onInput={(e) => setPw2(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </Field>
          <button class="btn primary" onClick={save}>
            Create &amp; continue
          </button>
        </div>
      </div>
    </div>
  );
}

export function Login(p: { settings: AppSettings; onLogin: (s: Session) => void }) {
  const [role, setRole] = useState<'INSTRUCTOR' | 'STUDENT'>('STUDENT');
  const [pw, setPw] = useState('');
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classId, setClassId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [pin, setPin] = useState('');
  useEffect(() => {
    db.all('classes').then((c) => setClasses(c.filter((x) => !x.archived).sort((a, b) => b.createdAt - a.createdAt)));
    db.all('students').then(setStudents);
  }, []);
  const st = students.find((s) => s.id === studentId);
  const go = async () => {
    if (role === 'INSTRUCTOR') {
      if (hashSecret(pw) !== p.settings.instructorHash) return toast('Wrong password.', 'err');
      p.onLogin({ role: 'INSTRUCTOR', name: p.settings.instructorName });
      return;
    }
    if (!st) return toast('Select your name.', 'err');
    if (st.pinHash) {
      if (hashSecret(pin, st.id) !== st.pinHash) return toast('Wrong PIN.', 'err');
    } else if (pin) {
      await db.put('students', { ...st, pinHash: hashSecret(pin, st.id) });
      toast('PIN set — use it next time.', 'ok');
    }
    p.onLogin({ role: 'STUDENT', studentId: st.id, name: `${st.rank} ${st.name}` });
  };
  const inClass = students.filter((s) => s.classId === classId).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div class="login-wrap hero">
      <div class="login-card">
        <Art />
        <div class="login-form">
          <div class="muted small">{p.settings.institution}</div>
          <h2>Log in</h2>
          <div class="role-pick">
            <button class={role === 'STUDENT' ? 'on' : ''} onClick={() => setRole('STUDENT')}>
              <b>STUDENT</b>
              <span class="muted small">Exercises, wargames, debriefs</span>
            </button>
            <button class={role === 'INSTRUCTOR' ? 'on' : ''} onClick={() => setRole('INSTRUCTOR')}>
              <b>INSTRUCTOR</b>
              <span class="muted small">Classes, scenarios, results</span>
            </button>
          </div>
          {role === 'INSTRUCTOR' ? (
            <Field label="Instructor password">
              <input type="password" value={pw} autoFocus onInput={(e) => setPw(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
            </Field>
          ) : (
            <>
              <Field label="Class / course">
                <select value={classId} onChange={(e) => (setClassId(e.currentTarget.value), setStudentId(''))}>
                  <option value="">— select —</option>
                  {classes.map((c) => (
                    <option value={c.id}>
                      {c.name} {c.course ? `(${c.course})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Name">
                <select value={studentId} onChange={(e) => setStudentId(e.currentTarget.value)} disabled={!classId}>
                  <option value="">— select —</option>
                  {inClass.map((s) => (
                    <option value={s.id}>
                      {s.rank} {s.name} {s.number ? `(${s.number})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={st && !st.pinHash ? 'Set a PIN (optional, first login)' : 'PIN'}>
                <input type="password" value={pin} onInput={(e) => setPin(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
              </Field>
              {classes.length === 0 && <div class="muted small">No classes yet — the instructor must first create a class and add students.</div>}
            </>
          )}
          <button class="btn primary" onClick={go}>
            Enter
          </button>
          <div class="dim small">v{__APP_VERSION__} · data stays on this computer (or your LAN server)</div>
        </div>
      </div>
    </div>
  );
}
