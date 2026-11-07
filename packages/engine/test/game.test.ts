// CBT-03/04/07, SET-04/05, MOV-01, VIS-03, FS-01/02, ISR-01/02, UNIT-04, VIC-01/02 and replay (AAR-01, NFR-05).
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { drawAt, hashString } from '../src/rng';
import { stepsOf } from '../src/state';
import { must, startedGame, tinyCtx } from './scenario';

describe('deployment (SET-04 / SET-05)', () => {
  it('only allows placement inside the own zone, then locks', () => {
    const g = new Game(tinyCtx(), 1);
    expect(g.state.phase).toBe('deploy');
    expect(g.dispatch('red', { type: 'EndDeployment' })).toMatchObject({ ok: false, error: { code: 'not_your_turn' } });
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 5, r: 1 } })).toMatchObject({ ok: false, error: { code: 'outside_zone' } });
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'r1', hex: { q: 1, r: 1 } })).toMatchObject({ ok: false, error: { code: 'not_your_unit' } });
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'b4', hex: { q: 1, r: 1 } })).toMatchObject({ ok: false, error: { code: 'mounted' } });
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 99, r: 1 } })).toMatchObject({ ok: false, error: { code: 'off_map' } });
    must(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 2, r: 4 } }));
    expect(g.state.units.b1.hex).toEqual({ q: 2, r: 4 });
    expect(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 2, r: 3 } })).toMatchObject({ ok: false, error: { code: 'not_play_phase' } });
    // the enemy never sees the set-up before the battle (SET-05)
    const redView = JSON.stringify(g.view('red'));
    expect(redView).not.toContain('"b1"');
    expect(g.view('blue').deploymentZone.length).toBeGreaterThan(0);
    must(g.dispatch('blue', { type: 'EndDeployment' }));
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 2, r: 3 } })).toMatchObject({ ok: false, error: { code: 'not_your_turn' } });
    must(g.dispatch('red', { type: 'EndDeployment' }));
    expect(g.state.phase).toBe('play');
    expect(g.state.turn).toBe(1);
    expect(g.state.activeSide).toBe('blue');
    expect(g.dispatch('blue', { type: 'EndDeployment' })).toMatchObject({ ok: false, error: { code: 'not_deployment_phase' } });
  });

  it('refuses to end deployment with units unplaced and enforces stacking', () => {
    const g = new Game(
      tinyCtx((s) => {
        delete s.sides.blue.orbat[0].hex;
      }),
      1,
    );
    expect(g.dispatch('blue', { type: 'EndDeployment' })).toMatchObject({ ok: false, error: { code: 'units_not_deployed' } });
    must(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 1, r: 3 } }));
    must(g.dispatch('blue', { type: 'Deploy', unitId: 'b2', hex: { q: 1, r: 3 } }));
    // b3 already there -> 3 ground units, the UAV does not count
    must(g.dispatch('blue', { type: 'Deploy', unitId: 'b5', hex: { q: 1, r: 3 } }));
    expect(g.dispatch('blue', { type: 'Deploy', unitId: 'b1', hex: { q: 1, r: 3 } }).ok).toBe(true);
  });
});

describe('turns (MOV-01) and movement', () => {
  it('alternates sides, counts turns and ends after the turn limit', () => {
    const g = startedGame();
    for (let t = 1; t <= 4; t++) {
      expect(g.state.turn).toBe(t);
      must(g.dispatch('blue', { type: 'EndTurn' }));
      expect(g.state.activeSide).toBe('red');
      must(g.dispatch('red', { type: 'EndTurn' }));
    }
    expect(g.state.phase).toBe('over');
    expect(g.state.result).toMatchObject({ winner: 'red', reason: 'objectives' });
    expect(g.dispatch('blue', { type: 'EndTurn' })).toMatchObject({ ok: false, error: { code: 'game_over' } });
  });

  it('moves along the cheapest path, sets the posture band and blocks illegal moves', () => {
    const g = startedGame();
    expect(g.dispatch('red', { type: 'MoveUnit', unitId: 'r1', to: { q: 5, r: 1 } })).toMatchObject({ ok: false, error: { code: 'not_your_turn' } });
    expect(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 1, r: 1 } })).toMatchObject({ ok: false, error: { code: 'same_hex' } });
    expect(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 9, r: 1 } })).toMatchObject({ ok: false, error: { code: 'unreachable' } });
    expect(g.dispatch('blue', { type: 'MoveUnit', unitId: 'zz', to: { q: 2, r: 1 } })).toMatchObject({ ok: false, error: { code: 'unknown_unit' } });
    expect(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b4', to: { q: 2, r: 1 } })).toMatchObject({ ok: false, error: { code: 'mounted' } });
    const ev = must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 3, r: 1 } }));
    expect(g.state.units.b1.hex).toEqual({ q: 3, r: 1 });
    expect(g.state.units.b1.posture).toBe('moved');
    expect(ev.log.find((l) => l.k === 'move')).toMatchObject({ band: 'tactical', mp: 2 });
    must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 3, r: 3 } }));
    expect(g.state.units.b1.posture).toBe('dashed');
  });

  it('a move into a hidden enemy halts in contact', () => {
    const g = startedGame(3, (s, m) => {
      // hide the red section in woods out of sight
      m.hexes.find((h) => h.q === 4 && h.r === 1)!.terrainId = 'woods';
      s.sides.red.deploymentZone.push({ q: 4, r: 1 });
      s.sides.red.orbat[0].hex = { q: 4, r: 1 };
      s.sides.blue.orbat = s.sides.blue.orbat.filter((o) => o.id === 'b1');
      s.sides.blue.orbat[0].hex = { q: 0, r: 1 };
    });
    expect(g.state.visible.blue).not.toContain('r1');
    const ev = must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 4, r: 1 } }));
    expect(ev.log.some((l) => l.k === 'contact')).toBe(true);
    expect(g.state.units.b1.hex).toEqual({ q: 3, r: 1 });
    expect(g.state.visible.blue).toContain('r1');
  });
});

describe('fire, suppression and losses (CBT-03 / CBT-04)', () => {
  it('fire resolves with recorded dice and updates status letters', () => {
    const g = startedGame(7, (s) => {
      s.sides.red.orbat[0].hex = { q: 3, r: 1 };
      s.sides.red.deploymentZone.push({ q: 3, r: 1 });
    });
    expect(g.state.visible.blue).toContain('r1');
    expect(g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'section_arms', targetId: 'b2' })).toMatchObject({ ok: false, error: { code: 'invalid_target' } });
    const ev = must(g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'section_arms', targetId: 'r1' }));
    const fire = ev.log.find((l) => l.k === 'fire')!;
    expect(fire.k).toBe('fire');
    if (fire.k !== 'fire') return;
    expect(fire.p).toBeCloseTo(0.42, 10);
    expect(ev.rngDraws.length).toBeGreaterThanOrEqual(1);
    expect(fire.roll).toBe(Math.floor(ev.rngDraws[0] * 100));
    expect(fire.hit).toBe(ev.rngDraws[0] < 0.42);
    expect(g.state.units.b1.fired).toBe(true);
    expect(g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'rpg', targetId: 'r1' })).toMatchObject({ ok: false, error: { code: 'no_shots' } });
  });

  it('hits suppress or remove steps; units are eliminated at 0 steps; suppressed units rally on their turn', () => {
    // fire repeatedly over many seeds and check the invariants of every outcome
    let sawStep = false;
    let sawSupp = false;
    let sawElim = false;
    let sawRally = false;
    for (let seed = 1; seed < 60 && !(sawStep && sawSupp && sawElim && sawRally); seed++) {
      const g = startedGame(seed, (s) => {
        s.sides.red.orbat[0] = { id: 'r1', typeId: 'sniper_team', name: 'R Snp', hex: { q: 2, r: 1 } };
        s.sides.red.deploymentZone.push({ q: 2, r: 1 });
      });
      const before = g.state.units.r1.steps;
      const ev = must(g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'section_arms', targetId: 'r1' }));
      const f = ev.log.find((l) => l.k === 'fire');
      if (!f || f.k !== 'fire') continue;
      if (f.effect === 'suppressed') {
        sawSupp = true;
        expect(g.state.units.r1.status).toBe('S');
        expect(g.state.units.r1.steps).toBe(before);
        must(g.dispatch('blue', { type: 'EndTurn' }));
        const rally = g.events[g.events.length - 1].log.find((l) => l.k === 'rally');
        if (rally && rally.k === 'rally') {
          sawRally = true;
          expect(g.state.units.r1.status).toBe(rally.ok ? 'C' : 'S');
          expect(rally.chance).toBeCloseTo(0.45, 10);
        }
      }
      if (f.effect === 'eliminated') {
        sawElim = true;
        expect(g.state.units.r1.eliminated).toBe(true);
        expect(g.view('blue').units.some((u) => u.id === 'r1')).toBe(false);
      }
      if (f.effect === 'step') sawStep = true;
    }
    expect(sawSupp && sawElim && sawRally).toBe(true);
  });

  it('attrition below the threshold ends the game at once (VIC-02)', () => {
    const g = startedGame(5, (s) => {
      s.victoryRules.attritionWinBelowPct = { red: 0.99 };
      s.sides.red.orbat[0].hex = { q: 2, r: 1 };
      s.sides.red.deploymentZone.push({ q: 2, r: 1 });
    });
    for (let i = 0; i < 40 && g.state.phase === 'play'; i++) {
      if (g.state.activeSide === 'blue' && g.state.units.b1.status === 'C' && g.state.units.b1.shots === 0)
        g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'section_arms', targetId: 'r1' });
      else must(g.dispatch(g.state.activeSide, { type: 'EndTurn' }));
    }
    expect(g.state.result).toMatchObject({ winner: 'blue', reason: 'attrition' });
  });
});

describe('fire support and ISR', () => {
  it('mortars need an observer (FS-01); the UAV provides one from altitude (ISR-01)', () => {
    const g = startedGame(11, (s, m) => {
      for (const h of m.hexes) if (h.q === 4) h.terrainId = 'woods';
      s.sides.blue.orbat = s.sides.blue.orbat.filter((o) => o.id !== 'b5' && o.id !== 'b3' && o.id !== 'b4');
      s.sides.red.orbat[0].hex = { q: 7, r: 2 };
    });
    // woods column at q=4 hides the target hex from the ground
    expect(g.dispatch('blue', { type: 'IndirectFire', unitId: 'b2', weaponId: 'mortar60', hex: { q: 7, r: 2 } })).toMatchObject({ ok: false, error: { code: 'no_observer' } });
    const g2 = startedGame(11, (s, m) => {
      for (const h of m.hexes) if (h.q === 4) h.terrainId = 'woods';
      s.sides.red.orbat[0].hex = { q: 7, r: 2 };
      s.sides.blue.orbat.find((o) => o.id === 'b5')!.hex = { q: 2, r: 2 };
    });
    expect(g2.state.visible.blue).toContain('r1');
    const ev = must(g2.dispatch('blue', { type: 'IndirectFire', unitId: 'b2', weaponId: 'mortar60', hex: { q: 7, r: 2 } }));
    expect(ev.log.find((l) => l.k === 'impact')).toMatchObject({ observed: true, targets: 1 });
    expect(g2.state.units.b2.ammo.mortar60).toBe(19);
  });

  it('off-map artillery: limited missions, available from turn N, lands after the delay (FS-02)', () => {
    const g = startedGame(13, (s) => {
      s.sides.red.orbat[0].hex = { q: 3, r: 2 };
      s.sides.red.deploymentZone.push({ q: 3, r: 2 });
    });
    expect(g.dispatch('blue', { type: 'CallFire', assetId: 'nope', hex: { q: 3, r: 2 } })).toMatchObject({ ok: false, error: { code: 'unknown_asset' } });
    must(g.dispatch('blue', { type: 'CallFire', assetId: 'arty', hex: { q: 3, r: 2 } }));
    expect(g.state.pendingFires).toHaveLength(1);
    expect(g.view('blue').fireSupport[0].missionsLeft).toBe(1);
    expect(JSON.stringify(g.view('red'))).not.toContain('"arty"');
    must(g.dispatch('blue', { type: 'CallFire', assetId: 'arty', hex: { q: 3, r: 2 } }));
    expect(g.dispatch('blue', { type: 'CallFire', assetId: 'arty', hex: { q: 3, r: 2 } })).toMatchObject({ ok: false, error: { code: 'no_missions' } });
    must(g.dispatch('blue', { type: 'EndTurn' }));
    must(g.dispatch('red', { type: 'EndTurn' }));
    const landing = g.events[g.events.length - 1].log.filter((l) => l.k === 'impact');
    expect(landing).toHaveLength(2);
    expect(g.state.pendingFires).toHaveLength(0);
    // red's guns are immediate (delay 0)
    const g2 = startedGame(13, (s) => {
      s.sides.red.fireSupport[0].fromTurn = 2;
    });
    must(g2.dispatch('blue', { type: 'EndTurn' }));
    expect(g2.dispatch('red', { type: 'CallFire', assetId: 'rarty', hex: { q: 1, r: 1 } })).toMatchObject({ ok: false, error: { code: 'fire_support_not_yet' } });
  });

  it('UAVs can be shot down and their viewshed disappears (ISR-02); endurance runs out (ISR-03)', () => {
    let downed = false;
    for (let seed = 1; seed < 200 && !downed; seed++) {
      const g = startedGame(seed, (s) => {
        // the UAV loiters 2 hexes from the red section (small-arms air band)
        s.sides.blue.orbat.find((o) => o.id === 'b5')!.hex = { q: 2, r: 2 };
        s.sides.red.orbat[0].hex = { q: 4, r: 2 };
        s.sides.red.deploymentZone.push({ q: 4, r: 2 });
        s.firstSide = 'red';
      });
      // UAV over the red section, red shoots it
      if (!g.state.visible.red.includes('b5')) continue;
      const r = g.dispatch('red', { type: 'Fire', unitId: 'r1', weaponId: 'section_arms', targetId: 'b5' });
      if (!r.ok) continue;
      if (g.state.units.b5.eliminated) {
        downed = true;
        expect(g.view('blue').units.some((u) => u.id === 'b5')).toBe(false);
      }
    }
    expect(downed).toBe(true);
    const g = startedGame(1, (s) => {
      s.turns = 20;
    });
    g.state.units.b5.enduranceLeft = 1;
    must(g.dispatch('blue', { type: 'EndTurn' }));
    must(g.dispatch('red', { type: 'EndTurn' }));
    expect(g.state.units.b5.eliminated).toBe(true);
  });
});

describe('mount / dismount (UNIT-04)', () => {
  it('foot units mount nearby vehicles, ride, and dismount using the move allowance', () => {
    const g = startedGame();
    expect(g.dispatch('blue', { type: 'Mount', unitId: 'b1', vehicleId: 'b3' })).toMatchObject({ ok: false, error: { code: 'too_far' } });
    expect(g.dispatch('blue', { type: 'Mount', unitId: 'b2', vehicleId: 'b5' })).toMatchObject({ ok: false, error: { code: 'vehicle_full' } });
    must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 1, r: 2 } }));
    must(g.dispatch('blue', { type: 'Mount', unitId: 'b1', vehicleId: 'b3' }));
    expect(g.state.units.b1.hex).toBeNull();
    expect(g.state.units.b3.passengers).toEqual(['b4', 'b1']);
    expect(g.dispatch('blue', { type: 'Mount', unitId: 'b2', vehicleId: 'b3' })).toMatchObject({ ok: false, error: { code: 'vehicle_full' } });
    must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b3', to: { q: 3, r: 3 } }));
    expect(g.dispatch('blue', { type: 'Dismount', unitId: 'b4', hex: { q: 6, r: 3 } })).toMatchObject({ ok: false, error: { code: 'too_far' } });
    must(g.dispatch('blue', { type: 'Dismount', unitId: 'b4', hex: { q: 4, r: 3 } }));
    expect(g.state.units.b4.hex).toEqual({ q: 4, r: 3 });
    expect(g.state.units.b4.posture).toBe('dashed');
    expect(g.dispatch('blue', { type: 'Dismount', unitId: 'b4', hex: { q: 4, r: 3 } })).toMatchObject({ ok: false, error: { code: 'not_mounted' } });
    expect(g.view('blue').units.find((u) => u.id === 'b3')!.passengers).toEqual(['b1']);
  });

  it('passengers may be lost when their vehicle is destroyed', () => {
    let seen = false;
    for (let seed = 1; seed < 400 && !seen; seed++) {
      const g = startedGame(seed, (s) => {
        s.firstSide = 'red';
        s.sides.red.orbat[1].hex = { q: 6, r: 3 };
      });
      g.state.units.b3.steps = 1;
      const r = g.dispatch('red', { type: 'Fire', unitId: 'r2', weaponId: 'tank_gun', targetId: 'b3' });
      if (!r.ok) continue;
      const loss = r.event.log.find((l) => l.k === 'passenger_loss');
      if (loss && loss.k === 'passenger_loss') {
        seen = true;
        expect(g.state.units.b3.eliminated).toBe(true);
        expect(g.state.units.b4.carriedBy).toBeUndefined();
        expect(g.state.units.b4.status).toBe('S');
        expect(g.state.units.b4.steps).toBe(loss.lost ? 1 : 2);
      }
    }
    expect(seen).toBe(true);
  });
});

describe('fog of war (VIS-03, SET-05, NFR-04)', () => {
  it('views contain only currently visible enemies and ghosts of last-seen ones', () => {
    const g = startedGame(17, (s, m) => {
      m.hexes.find((h) => h.q === 6 && h.r === 1)!.terrainId = 'woods';
      s.sides.blue.orbat = s.sides.blue.orbat.filter((o) => o.id === 'b1');
    });
    expect(g.state.visible.blue).toContain('r2'); // tank in the open
    expect(g.state.visible.blue).not.toContain('r1'); // section concealed in woods beyond range
    const v = g.view('blue');
    expect(v.units.map((u) => u.id)).toEqual(['b1', 'r2']);
    expect(JSON.stringify(v)).not.toContain('"r1"');
    // the tank moves behind the woods: it becomes a ghost
    must(g.dispatch('blue', { type: 'EndTurn' }));
    must(g.dispatch('red', { type: 'MoveUnit', unitId: 'r2', to: { q: 7, r: 1 } }));
    must(g.dispatch('red', { type: 'MoveUnit', unitId: 'r1', to: { q: 7, r: 0 } }));
    const v2 = g.view('blue');
    if (!g.state.visible.blue.includes('r2')) {
      expect(v2.ghosts.find((x) => x.id === 'r2')).toMatchObject({ hex: { q: 8, r: 3 }, turn: 1 });
    }
    // red's moves are redacted for blue unless seen
    const blueLog = g.logFor('blue');
    for (const l of blueLog) if (l.side === 'red' && l.k === 'move') expect(g.state.visible.blue).toContain(l.unitId);
    expect(g.logFor('red').some((l) => l.k === 'move' && l.unitId === 'r1')).toBe(true);
    // enemy units are named by type only
    for (const l of blueLog) if (l.side === 'red' && l.k === 'move') expect(l.name).not.toMatch(/^R /);
  });

  it('a unit that fires is revealed to the enemy (VIS-04 firing rule)', () => {
    const g = startedGame(19, (s, m) => {
      m.hexes.find((h) => h.q === 2 && h.r === 1)!.terrainId = 'woods';
      s.sides.blue.orbat = [{ id: 'b1', typeId: 'sniper_team', name: 'Snp', hex: { q: 2, r: 1 } }];
      // a fire team with the naked eye only: woods cut its 12-hex range to 4.8
      s.sides.red.orbat = [{ id: 'r1', typeId: 'fire_team', name: 'R FT', hex: { q: 8, r: 1 } }];
    });
    expect(g.state.visible.blue).toContain('r1');
    expect(g.state.visible.red).not.toContain('b1');
    const ev = must(g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'sniper_rifle', targetId: 'r1' }));
    const f = ev.log.find((l) => l.k === 'fire')!;
    if (g.state.units.r1.eliminated) return;
    expect(g.state.visible.red).toContain('b1');
    if (f.k === 'fire') expect(f.shooterSeenBy).toContain('red');
    expect(g.logFor('red').some((l) => l.k === 'fire' && l.shooterId === 'b1')).toBe(true);
  });

  it('enemy fire from an unseen shooter is redacted in the log', () => {
    const g = startedGame(21, (s, m) => {
      m.hexes.find((h) => h.q === 7 && h.r === 1)!.terrainId = 'woods';
      s.sides.blue.orbat = [{ id: 'b1', typeId: 'rifle_section', name: '1 Sec', hex: { q: 1, r: 1 } }];
      s.sides.red.orbat = [{ id: 'r1', typeId: 'mortar81_sec', name: 'R Mor', hex: { q: 9, r: 5 } }, { id: 'r2', typeId: 'recce_team', name: 'R Recce', hex: { q: 7, r: 1 } }];
      s.sides.red.deploymentZone.push({ q: 7, r: 1 });
      s.firstSide = 'red';
    });
    const ev = must(g.dispatch('red', { type: 'IndirectFire', unitId: 'r1', weaponId: 'mortar81', hex: { q: 1, r: 1 } }));
    expect(ev.log.some((l) => l.k === 'impact')).toBe(true);
    const blueLog = g.logFor('blue');
    const impact = blueLog.find((l) => l.k === 'impact')!;
    if (impact.k === 'impact') expect(impact.sourceName).toBe('');
    for (const l of blueLog) if (l.k === 'fire' && l.side === 'red') expect(l.shooterId).toBe('');
  });
});

describe('objectives (VIC-01) and scoring (VIC-03)', () => {
  it('ownership changes when only one side occupies, and VP update', () => {
    const g = startedGame(23);
    expect(g.view('blue').vp).toEqual({ blue: 0, red: 3 });
    must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 3, r: 3 } }));
    must(g.dispatch('blue', { type: 'EndTurn' }));
    must(g.dispatch('red', { type: 'EndTurn' }));
    must(g.dispatch('blue', { type: 'MoveUnit', unitId: 'b1', to: { q: 3, r: 4 } }));
    const ev = must(g.dispatch('blue', { type: 'EndTurn' }));
    expect(ev.log.find((l) => l.k === 'objective')).toMatchObject({ objectiveId: 'o2', to: 'blue', from: null });
    expect(ev.log.find((l) => l.k === 'vp')).toMatchObject({ blue: 1, red: 3 });
    expect(g.state.objectives.o2).toBe('blue');
  });
});

describe('determinism and replay (CBT-07, AAR-01, NFR-05)', () => {
  function playScript(seed: number): Game {
    const g = startedGame(seed, (s) => {
      s.sides.red.orbat[0].hex = { q: 3, r: 1 };
      s.sides.red.deploymentZone.push({ q: 3, r: 1 });
    });
    g.dispatch('blue', { type: 'Fire', unitId: 'b1', weaponId: 'section_arms', targetId: 'r1' });
    g.dispatch('blue', { type: 'IndirectFire', unitId: 'b2', weaponId: 'mortar60', hex: { q: 3, r: 1 } });
    g.dispatch('blue', { type: 'CallFire', assetId: 'arty', hex: { q: 3, r: 1 } });
    g.dispatch('blue', { type: 'EndTurn' });
    g.dispatch('red', { type: 'Fire', unitId: 'r1', weaponId: 'section_arms', targetId: 'b1' });
    g.dispatch('red', { type: 'Fire', unitId: 'r2', weaponId: 'tank_gun', targetId: 'b3' });
    g.dispatch('red', { type: 'EndTurn' });
    g.dispatch('blue', { type: 'EndTurn' });
    return g;
  }

  it('same seed + same commands = same events; different seeds differ', () => {
    const a = playScript(99);
    const b = playScript(99);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.state).toEqual(b.state);
    const c = playScript(100);
    expect(JSON.stringify(c.events.map((e) => e.rngDraws))).not.toBe(JSON.stringify(a.events.map((e) => e.rngDraws)));
  });

  it('replaying the log reproduces every result', () => {
    const a = playScript(4242);
    const r = Game.replay(a.ctx, 4242, a.events, { verifyLog: true });
    expect(r.state).toEqual(a.state);
    expect(r.logFor('blue')).toEqual(a.logFor('blue'));
    expect(a.events.reduce((m, e) => m + e.rngDraws.length, 0)).toBe(a.state.rngCursor);
  });

  it('a tampered or reordered log is refused', () => {
    const a = playScript(77);
    const withDice = a.events.findIndex((e) => e.rngDraws.length > 0);
    const tampered = structuredClone(a.events);
    tampered[withDice].rngDraws[0] = 0.0001; // a guaranteed hit
    expect(() => Game.replay(a.ctx, 77, tampered)).toThrow(/tampered/);
    const extra = structuredClone(a.events);
    extra[withDice].rngDraws.push(drawAt(77, 999999));
    expect(() => Game.replay(a.ctx, 77, extra, { verifyDice: false })).toThrow(/more dice/);
    const short = structuredClone(a.events);
    short[withDice].rngDraws = [];
    expect(() => Game.replay(a.ctx, 77, short, { verifyDice: false })).toThrow(/exhausted/);
    expect(() => Game.replay(a.ctx, 77, a.events.slice(1))).toThrow(/out of order/);
    const illegal = structuredClone(a.events);
    illegal[illegal.length - 1].side = 'red';
    expect(() => Game.replay(a.ctx, 77, illegal)).toThrow(/illegal on replay/);
    const changed = structuredClone(a.events);
    changed[withDice].log = [];
    expect(() => Game.replay(a.ctx, 77, changed, { verifyLog: true })).toThrow(/differ/);
  });

  it('hashString is stable', () => {
    expect(hashString('tiny')).toBe(hashString('tiny'));
    expect(hashString('tiny')).not.toBe(hashString('tinz'));
    expect(stepsOf(startedGame().state, 'blue')).toBeGreaterThan(0);
  });
});
