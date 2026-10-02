import { useEffect, useState } from 'preact/hooks';
import type { AppSettings } from '../core/types';
import { db, dbKind, initDb } from '../store/db';
import { ensureSeed } from './data';
import { AttemptReview } from './exercise/review';
import { ExerciseFlow } from './exercise/flow';
import { InstructorHome } from './instructor/home';
import { ScenarioView } from './instructor/scenarioView';
import { getSession, nav, setSession, Toasts, useRoute } from './kit';
import { Login, Setup } from './login';
import { StudentHome } from './student/home';

export function App() {
  const route = useRoute();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [, force] = useState(0);
  useEffect(() => {
    initDb()
      .then(ensureSeed)
      .then(() => db.get('settings', 'settings'))
      .then((st) => {
        setSettings(st);
        setReady(true);
      });
  }, []);
  if (!ready) return <div class="login-wrap muted">Loading WarGamer…</div>;
  if (!settings)
    return (
      <>
        <Setup
          onDone={(st) => {
            setSettings(st);
            nav('');
          }}
        />
        <Toasts />
      </>
    );
  const session = getSession();
  if (!session || route[0] === 'login')
    return (
      <>
        <Login
          settings={settings}
          onLogin={(s) => {
            setSession(s);
            force((x) => x + 1);
            nav(s.role === 'INSTRUCTOR' ? 'instructor' : 'student');
          }}
        />
        <Toasts />
      </>
    );

  let body;
  const [r0, r1, r2] = route;
  const fullscreen = r0 === 'ex';
  if (r0 === 'ex' && r1) body = <ExerciseFlow attemptId={r1} step={r2} session={session} />;
  else if (r0 === 'scenario' && r1 && session.role === 'INSTRUCTOR') body = <ScenarioView id={r1} />;
  else if (r0 === 'attempt' && r1) body = <AttemptReview id={r1} session={session} />;
  else if (session.role === 'INSTRUCTOR') body = <InstructorHome tab={r1} settings={settings} onSettings={setSettings} />;
  else body = <StudentHome session={session} tab={r1} />;

  return (
    <div class="shell">
      <div class="topbar">
        <div class="brand" style={{ cursor: 'pointer' }} onClick={() => nav(session.role === 'INSTRUCTOR' ? 'instructor' : 'student')}>
          <span class="logo" />
          WARGAMER
          <small>{settings.institution}</small>
        </div>
        <div class="right row">
          <span class="who" title={`Storage: ${dbKind()}`}>
            {session.role === 'INSTRUCTOR' ? '🎖 Instructor' : '🪖 Student'} · {session.name}
          </span>
          <span class="badge b-grey" title="Where data is stored">
            {dbKind() === 'LAN' ? 'LAN shared' : dbKind() === 'IDB' ? 'Offline · this PC' : 'Temporary (memory)'}
          </span>
          <button
            class="btn small"
            onClick={() => {
              setSession(null);
              nav('login');
              force((x) => x + 1);
            }}
          >
            Log out
          </button>
        </div>
      </div>
      <div class="main" style={fullscreen ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : undefined}>
        {body}
      </div>
      <Toasts />
    </div>
  );
}
