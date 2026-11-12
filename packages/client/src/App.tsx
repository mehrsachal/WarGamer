import { useEffect, useState } from 'react';
import { AnalyserScreen } from './analysis/AnalyserScreen';
import { GameScreen } from './game/GameScreen';
import { Briefing, Home } from './home/Home';

type Route = { name: 'home' } | { name: 'analyser' } | { name: 'scenario'; id: string } | { name: 'game'; id: string };

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'scenario' && b) return { name: 'scenario', id: b };
  if (a === 'game' && b) return { name: 'game', id: b };
  if (a === 'analyser') return { name: 'analyser' };
  return { name: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (h: string) => (location.hash = h);
  if (route.name === 'scenario') return <Briefing id={route.id} onBack={() => go('/')} onStarted={(g) => go(`/game/${g}`)} />;
  if (route.name === 'game') return <GameScreen key={route.id} gameId={route.id} onExit={() => go('/')} />;
  if (route.name === 'analyser') return <AnalyserScreen onExit={() => go('/')} />;
  return <Home onOpen={(id) => go(`/scenario/${id}`)} onResume={(g) => go(`/game/${g}`)} />;
}
