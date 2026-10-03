// Planner side panels: properties of the selection (unit / graphic / group / multi), the Task
// Org (ORBAT) tree with drag-and-drop attachment, the symbol palette, QC sorties and checklist.
import { useState } from 'preact/hooks';
import { DOCTRINE } from '../../core/doctrine';
import { dist } from '../../core/geom';
import { dDay, fmtTime, splitTime } from '../../core/time';
import type { GraphicKind, Plan, PlanGraphic, PlacedUnit, Role } from '../../core/types';
import { TEMPLATES } from '../../core/units';
import { areaExtentFacing, doctrineFrontage, isAreaUnit, unitArea } from '../../plan/area';
import { FOUND_ROLES, baseStrength, descendants, foundTag, localities, mergeBack, primaryWeapon, setGroup, splitOptions, splitUnit, strengthBook, strengthText, ungroup } from '../../plan/taskorg';
import { symbolSvg } from '../../render/symbols';
import { MARKS_AS, PaletteItem, retag, SHAPE_PALETTE, SYMBOL_PALETTE, type Selection } from './planEdit';
import type { StepProps } from './flow';

export type Edit = (fn: (pl: Plan) => void) => void;

export const ROLES: { id: Role; label: string }[] = [
  { id: 'FDL', label: 'FDL (fwd locality)' },
  { id: 'DEPTH', label: 'Depth' },
  { id: 'RES', label: 'Reserve / C attk force' },
  { id: 'SCREEN', label: 'Screen' },
  { id: 'SP_PTL', label: 'Standing ptl' },
  { id: 'LP', label: 'LP' },
  { id: 'OP', label: 'OP' },
  { id: 'SP_WPN', label: 'Sp wpn' },
  { id: 'OBS', label: 'Obsr' },
  { id: 'CHQ', label: 'HQ' },
  { id: 'CP', label: 'CP' },
  { id: 'QC', label: 'QC det' },
  { id: 'ENGR', label: 'Engr / pnr' },
];

export const COLORS: { id: NonNullable<PlanGraphic['props']['color']>; hex: string; label: string }[] = [
  { id: 'BLUE', hex: '#0b5cad', label: 'Own (blue)' },
  { id: 'RED', hex: '#c62828', label: 'Enemy (red)' },
  { id: 'BLACK', hex: '#1b2329', label: 'Neutral (black)' },
  { id: 'GREEN', hex: '#13803a', label: 'Obstacles (green)' },
  { id: 'PURPLE', hex: '#5b2a86', label: 'Fire (purple)' },
  { id: 'AMBER', hex: '#c77700', label: 'Amber' },
];

function Sym(p: { sidc: string; size?: number }) {
  return <img class="tosym" src={symbolSvg(p.sidc, p.size ?? 16)} alt="" />;
}

/** Goose-egg badge with the echelon indicator on top (properties header). */
const ECH_MARK: Record<string, string> = { TEAM: '•', SEC: '••', PL: '•••', COY: '|', BN: '||', BDE: 'X' };
function EggIcon(p: { echelon: string }) {
  return (
    <svg class="s2-eggicon" viewBox="0 0 48 40" aria-hidden="true">
      <text x="24" y="10" text-anchor="middle">
        {ECH_MARK[p.echelon] ?? ''}
      </text>
      <ellipse cx="24" cy="25" rx="20" ry="11" />
      <path d="M17 20l14 10M31 20l-14 10" />
    </svg>
  );
}

// ---------------------------------------------------------------------------- unit

export function UnitProps(x: { u: PlacedUnit; p: StepProps; edit: Edit; commit: Edit; onTool: (t: 'face' | 'alt' | 'drawArea') => void; onDelete: () => void; onSelect: (id: string) => void }) {
  const { u, p } = x;
  const plan = p.attempt.plan;
  const t = TEMPLATES[u.templateKey];
  const ro = p.readOnly;
  const [men, setMen] = useState(3);
  const set = (fn: (v: PlacedUnit) => void, history = true) =>
    (history ? x.commit : x.edit)((pl) => {
      const v = pl.units.find((y) => y.id === u.id);
      if (v) fn(v);
    });
  const book = strengthBook(plan);
  const e = book.get(u.id);
  const egg = isAreaUnit(u);
  const found = FOUND_ROLES.has(u.role);
  const parents = localities(plan, u.id).filter((l) => !descendants(plan, u.id).some((d) => d.id === l.id));
  const so = splitOptions(plan, u);
  const ext = egg ? areaExtentFacing(unitArea(u), u.facing) : null;
  const band = doctrineFrontage(u.templateKey);
  const origin = u.splitFrom ? plan.units.find((y) => y.id === u.splitFrom) : undefined;
  const groups = plan.groups ?? [];
  const split = (o: Parameters<typeof splitUnit>[2]) => {
    let made: PlacedUnit[] = [];
    x.commit((pl) => (made = splitUnit(pl, u.id, o)));
    if (made[0]) x.onSelect(made[0].id);
  };
  return (
    <div class="sect col s2-props">
      <div class="row">
        {u.role === 'LP' || u.templateKey === 'LP' ? <span class="s2-oplp">▲</span> : egg ? <EggIcon echelon={t.echelon} /> : <img src={symbolSvg(t.sidc, 26)} alt="" style={{ height: 40 }} />}
        <div class="grow">
          <b>{u.label}</b>
          <div class="muted small">
            {u.role === 'OP' && u.templateKey === 'LP' ? 'Observation Post' : t.name}
            {egg ? ' · area (goose egg)' : ''}
          </div>
        </div>
      </div>
      {origin && (
        <div class="s2-note">
          Split from <a onClick={() => x.onSelect(origin.id)}>{origin.label}</a> — {strengthText(baseStrength(u))} all rks.{' '}
          {!ro && (
            <button class="btn small ghost" onClick={() => (x.commit((pl) => mergeBack(pl, u.id)), x.onSelect(origin.id))}>
              ⤺ Merge back
            </button>
          )}
        </div>
      )}
      <div class="s2-kv">
        <span>Strength</span>
        <b>
          {e?.effective ?? baseStrength(u)}
          {e && e.detached > 0 ? <span class="muted"> of {e.base} ({e.detached} det)</span> : null}
        </b>
      </div>
      <label class="field">
        Label
        <input disabled={ro} type="text" value={u.label} onInput={(ev) => set((v) => (v.label = ev.currentTarget.value), false)} />
      </label>
      <label class="field">
        Role
        <select disabled={ro} value={u.role} onChange={(ev) => set((v) => (v.role = ev.currentTarget.value as Role))}>
          {ROLES.map((r) => (
            <option value={r.id}>{r.label}</option>
          ))}
        </select>
      </label>
      {(found || !egg) && (
        <label class="field">
          {found ? 'Found by (parent locality)' : 'Attached to / grouped with'}
          <select disabled={ro} value={u.parentId ?? ''} onChange={(ev) => set((v) => (v.parentId = ev.currentTarget.value || undefined))}>
            <option value="">{found ? '— not found from own locality —' : '—'}</option>
            {parents.map((l) => (
              <option value={l.id}>{l.label}</option>
            ))}
          </select>
          {found && u.parentId && <span class="dim small">{foundTag(plan, u)} — its strength is deducted from the parent in the wargame.</span>}
        </label>
      )}
      <label class="field">
        Primary arc (bearing {Math.round(u.facing)}°)
        <input disabled={ro} type="range" min={0} max={359} value={Math.round(u.facing)} onInput={(ev) => set((v) => (v.facing = Number(ev.currentTarget.value)), false)} />
      </label>
      <div class="row wrap">
        <button class="btn small" disabled={ro} onClick={() => x.onTool('face')}>
          🎯 Aim arc
        </button>
        <button class="btn small" disabled={ro} onClick={() => x.onTool('alt')}>
          ⇢ Altn posn
        </button>
        {u.altPos && (
          <button class="btn small" disabled={ro} onClick={() => set((v) => (v.altPos = undefined))}>
            Clear altn ({Math.round(dist(u.pos, u.altPos))} m)
          </button>
        )}
      </div>
      {egg && ext && (
        <div class="s2-box">
          <div class="s2-kv">
            <span>Area</span>
            <b>
              {Math.round(ext.front * 2)} m frontage × {Math.round(ext.depth * 2)} m
            </b>
          </div>
          {band && <div class="dim small">Doctrine: {band[0]}–{band[1]} m frontage ({TEMPLATES[u.templateKey].echelon.toLowerCase()}), field of fire ≥ {DOCTRINE.minFieldOfFire} m.</div>}
          <div class="row wrap" style={{ marginTop: 6 }}>
            <button class="btn small" disabled={ro} onClick={() => x.onTool('drawArea')} title="Freehand the outline of this locality on the map">
              ✎ Draw area
            </button>
            <button class="btn small" disabled={ro} onClick={() => set((v) => (v.area = undefined))} title="Default egg from doctrine, oriented to the arc">
              ↺ Reset egg
            </button>
          </div>
          <div class="dim small" style={{ marginTop: 4 }}>
            Drag the egg to move · white squares reshape · ⊕ inserts a point · Alt-click / right-click deletes one · round handles resize · ⟳ rotates.
          </div>
        </div>
      )}
      {!ro && (so.elements || so.one || so.men || so.weapon) && (
        <div class="s2-box">
          <h4 style={{ margin: '0 0 6px' }}>Divide (task org)</h4>
          <div class="row wrap">
            {so.elements && (
              <button class="btn small" onClick={() => split({ kind: 'ELEMENTS' })} title={`${so.elementsCount} x ${so.childName}; the HQ remains as the reduced ${t.short}`}>
                ✂ Split into {so.childName?.toLowerCase()}s
              </button>
            )}
            {so.one && (
              <button class="btn small" onClick={() => split({ kind: 'ONE' })}>
                Detach a {so.childName?.toLowerCase()}
              </button>
            )}
            {so.one && (
              <button class="btn small" onClick={() => split({ kind: 'ONE', role: 'SP_PTL' })} title="Detach a sec as a standing ptl found by this locality">
                + Standing ptl
              </button>
            )}
            {so.weapon && (
              <button class="btn small" onClick={() => split({ kind: 'WEAPON' })} title={`One ${primaryWeapon(u.templateKey)} with its crew`}>
                Split off 1 wpn
              </button>
            )}
          </div>
          {so.men && (
            <div class="row" style={{ marginTop: 6 }}>
              <span class="small">Detach</span>
              <input type="number" min={1} max={(e?.effective ?? 2) - 1} value={men} style={{ width: 56 }} onInput={(ev) => setMen(Number(ev.currentTarget.value))} />
              <span class="small">men as</span>
              <button class="btn small" onClick={() => split({ kind: 'MEN', men, role: 'LP' })}>
                LP
              </button>
              <button class="btn small" onClick={() => split({ kind: 'MEN', men, role: 'OP' })}>
                OP
              </button>
              <button class="btn small" onClick={() => split({ kind: 'MEN', men })}>
                Det
              </button>
            </div>
          )}
        </div>
      )}
      {groups.length > 0 && (
        <label class="field">
          Group
          <select disabled={ro} value={u.groupId ?? ''} onChange={(ev) => x.commit((pl) => setGroup(pl, u.id, ev.currentTarget.value || undefined))}>
            <option value="">— none —</option>
            {groups.map((g) => (
              <option value={g.id}>{g.label}</option>
            ))}
          </select>
        </label>
      )}
      <label class="field">
        Remarks
        <input disabled={ro} type="text" value={u.notes ?? ''} onInput={(ev) => set((v) => (v.notes = ev.currentTarget.value), false)} />
      </label>
      {!ro && (
        <button class="btn danger small" onClick={x.onDelete}>
          Remove {descendants(plan, u.id).length ? `(and ${descendants(plan, u.id).length} split elm)` : ''}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- graphic

export function GraphicProps(x: { g: PlanGraphic; p: StepProps; edit: Edit; commit: Edit; onDelete: () => void; onDuplicate: () => void }) {
  const { g, p } = x;
  const ro = p.readOnly;
  const plan = p.attempt.plan;
  const set = (fn: (v: PlanGraphic) => void, history = true) =>
    (history ? x.commit : x.edit)((pl) => {
      const v = pl.graphics.find((y) => y.id === g.id);
      if (v) fn(v);
    });
  const forces = plan.units.filter((u) => TEMPLATES[u.templateKey]?.kind === 'INF' || TEMPLATES[u.templateKey]?.kind === 'ARMOUR');
  const textKind = g.kind === 'NOTE' || g.kind === 'TEXT';
  const free = g.kind === 'FREE' || g.kind === 'AREA' || g.kind === 'ARROW' || g.kind === 'TEXT';
  const lineish = !['DF', 'CPEN', 'QC_AREA', 'NOTE', 'TEXT', 'TRP', 'SYMBOL'].includes(g.kind);
  const tag = MARKS_AS.find((m) => m.id === g.kind);
  return (
    <div class="sect col s2-props">
      <div class="row">
        <b class="grow">{tag?.label ?? g.kind}</b>
        <span class="dim small">{g.pts.length} pt{g.pts.length === 1 ? '' : 's'}</span>
      </div>
      <label class="field">
        Marks as
        <select
          disabled={ro}
          value={g.kind}
          onChange={(ev) => {
            const k = ev.currentTarget.value as GraphicKind;
            x.commit((pl) => {
              const i = pl.graphics.findIndex((y) => y.id === g.id);
              if (i >= 0) pl.graphics[i] = retag(pl.graphics[i], k, pl.graphics.filter((y) => y.kind === k).length + 1);
              if (k === 'FDL') pl.graphics = pl.graphics.filter((y) => y.kind !== 'FDL' || y.id === g.id);
            });
          }}
        >
          {MARKS_AS.map((m) => (
            <option value={m.id}>{m.label}</option>
          ))}
        </select>
        <span class="dim small">What the DS marking reads this graphic as. Re-tagging keeps the shape where it can.</span>
      </label>
      <label class="field">
        {textKind ? 'Text' : 'Label'}
        <input disabled={ro} type="text" value={textKind ? g.props.text ?? '' : g.props.label ?? ''} onInput={(ev) => set((v) => (textKind ? (v.props.text = ev.currentTarget.value) : (v.props.label = ev.currentTarget.value || undefined)), false)} />
      </label>
      {g.kind === 'DF' && (
        <>
          <label class="field">
            Fire unit
            <select disabled={ro} value={g.props.subtype ?? 'ARTY'} onChange={(ev) => set((v) => (v.props.subtype = ev.currentTarget.value))}>
              <option value="ARTY">Arty</option>
              {p.s.own.fire.mor81 && <option value="MOR81">81mm mor</option>}
              <option value="MOR60">60mm mor</option>
            </select>
          </label>
          <label class="check">
            <input disabled={ro} type="checkbox" checked={!!g.props.sos} onChange={(ev) => set((v) => (v.props.sos = ev.currentTarget.checked))} /> DF (SOS)
          </label>
        </>
      )}
      {g.kind === 'MINEFIELD' && (
        <label class="field">
          Type
          <select disabled={ro} value={g.props.subtype ?? 'PROTECTIVE'} onChange={(ev) => set((v) => (v.props.subtype = ev.currentTarget.value))}>
            <option value="PROTECTIVE">Protective (AP)</option>
            <option value="TACTICAL">A tk / tactical</option>
            <option value="NUISANCE">Nuisance</option>
          </select>
        </label>
      )}
      {g.kind === 'OBSTACLE' && (
        <label class="field">
          Type
          <select disabled={ro} value={g.props.subtype ?? 'GENERAL'} onChange={(ev) => set((v) => (v.props.subtype = ev.currentTarget.value))}>
            <option value="GENERAL">Obstacle line</option>
            <option value="ABATIS">Abatis</option>
            <option value="AT_DITCH">A tk ditch</option>
            <option value="ROADBLOCK">Road block</option>
          </select>
        </label>
      )}
      {g.kind === 'BOUNDARY' && (
        <label class="field">
          Echelon
          <select disabled={ro} value={g.props.subtype ?? 'PL'} onChange={(ev) => set((v) => (v.props.subtype = ev.currentTarget.value))}>
            {['SEC', 'PL', 'COY', 'BN', 'BDE'].map((e) => (
              <option value={e}>{e}</option>
            ))}
          </select>
        </label>
      )}
      {g.kind === 'KILL_AREA' && (
        <label class="field">
          Type
          <select disabled={ro} value={g.props.subtype ?? 'PRIMARY'} onChange={(ev) => set((v) => (v.props.subtype = ev.currentTarget.value))}>
            <option value="PRIMARY">Primary</option>
            <option value="SECONDARY">Secondary</option>
          </select>
        </label>
      )}
      {(g.kind === 'CATK' || g.kind === 'CPEN') && (
        <label class="field">
          Force
          <select disabled={ro} value={g.props.unitId ?? ''} onChange={(ev) => set((v) => (v.props.unitId = ev.currentTarget.value || undefined))}>
            <option value="">—</option>
            {forces.map((f) => (
              <option value={f.id}>
                {f.label} ({f.role.toLowerCase()})
              </option>
            ))}
          </select>
        </label>
      )}
      {g.kind === 'CATK' && (
        <label class="field">
          Priority
          <input disabled={ro} type="number" min={1} max={5} value={g.props.priority ?? 1} onInput={(ev) => set((v) => (v.props.priority = Number(ev.currentTarget.value)))} />
        </label>
      )}
      {(g.kind === 'QC_AREA' || g.kind === 'DF') && (
        <label class="field">
          Radius {Math.round(g.props.radius ?? 150)} m
          <input disabled={ro} type="range" min={50} max={g.kind === 'QC_AREA' ? 3000 : 400} step={25} value={g.props.radius ?? 150} onInput={(ev) => set((v) => (v.props.radius = Number(ev.currentTarget.value)), false)} />
        </label>
      )}
      {(free || g.kind === 'PHASE_LINE' || g.kind === 'BOUNDARY' || g.kind === 'FDL' || g.kind === 'CATK' || g.kind === 'PTL_ROUTE') && (
        <div class="s2-box">
          <div class="s2-swatches">
            {COLORS.map((c) => (
              <button title={c.label} disabled={ro} class={(g.props.color ?? '') === c.id ? 'on' : ''} style={{ background: c.hex }} onClick={() => set((v) => (v.props.color = c.id))} />
            ))}
          </div>
          {free && g.kind !== 'TEXT' && (
            <div class="row wrap" style={{ marginTop: 6 }}>
              <label class="check">
                <input disabled={ro} type="checkbox" checked={!!g.props.dash} onChange={(ev) => set((v) => (v.props.dash = ev.currentTarget.checked))} /> dashed
              </label>
              {(g.kind === 'FREE' || g.kind === 'AREA') && (
                <label class="check">
                  <input disabled={ro} type="checkbox" checked={g.props.fill ?? g.kind === 'AREA'} onChange={(ev) => set((v) => (v.props.fill = ev.currentTarget.checked))} /> fill
                </label>
              )}
              {g.kind === 'FREE' && (
                <label class="check">
                  <input disabled={ro} type="checkbox" checked={!!g.props.closed} onChange={(ev) => set((v) => (v.props.closed = ev.currentTarget.checked))} /> closed
                </label>
              )}
            </div>
          )}
          {free && (
            <label class="field">
              {g.kind === 'TEXT' ? 'Size' : 'Width'}
              <input disabled={ro} type="range" min={1} max={8} step={0.5} value={g.props.width ?? (g.kind === 'TEXT' ? 2 : 2.5)} onInput={(ev) => set((v) => (v.props.width = Number(ev.currentTarget.value)), false)} />
            </label>
          )}
        </div>
      )}
      {lineish && g.pts.length >= 3 && (
        <label class="check">
          <input disabled={ro} type="checkbox" checked={g.props.smooth ?? (g.kind === 'FREE' || g.kind === 'AREA' || g.kind === 'ARROW')} onChange={(ev) => set((v) => (v.props.smooth = ev.currentTarget.checked))} /> smooth curve
        </label>
      )}
      {(g.kind === 'TEXT' || g.kind === 'SYMBOL' || g.kind === 'TRP') && (
        <label class="field">
          Rotation {Math.round(g.props.rot ?? 0)}°
          <input disabled={ro} type="range" min={-180} max={180} value={g.props.rot ?? 0} onInput={(ev) => set((v) => (v.props.rot = Number(ev.currentTarget.value)), false)} />
        </label>
      )}
      <div class="dim small">{lineish ? 'Drag to move · drag white squares to reshape · ⊕ inserts · Alt-click / right-click a point deletes it.' : 'Drag to move.'}</div>
      {!ro && (
        <div class="row">
          <button class="btn small" onClick={x.onDuplicate} title="Ctrl+D">
            ⧉ Duplicate
          </button>
          <button class="btn danger small" onClick={x.onDelete}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- multi / group

export function MultiProps(x: { sel: Selection; p: StepProps; onGroup: () => void; onDelete: () => void; onSelect: (s: Selection) => void }) {
  const plan = x.p.attempt.plan;
  const units = plan.units.filter((u) => x.sel.units.includes(u.id));
  return (
    <div class="sect col s2-props">
      <b>
        {units.length} unit{units.length === 1 ? '' : 's'}
        {x.sel.graphics.length ? ` · ${x.sel.graphics.length} graphic${x.sel.graphics.length === 1 ? '' : 's'}` : ''} selected
      </b>
      <div class="s2-chips">
        {units.map((u) => (
          <span class="s2-chip" onClick={() => x.onSelect({ units: [u.id], graphics: [] })}>
            {u.label}
          </span>
        ))}
      </div>
      <div class="dim small">Drag any of them to move all together. Shift-click adds / removes; Shift-drag on empty ground box-selects.</div>
      {!x.p.readOnly && (
        <div class="row wrap">
          {units.length >= 2 && (
            <button class="btn small primary" onClick={x.onGroup}>
              ⬭ Group ({units.length})
            </button>
          )}
          <button class="btn danger small" onClick={x.onDelete}>
            Remove all
          </button>
        </div>
      )}
    </div>
  );
}

export function GroupProps(x: { gid: string; p: StepProps; edit: Edit; commit: Edit; onSelect: (s: Selection) => void }) {
  const plan = x.p.attempt.plan;
  const g = plan.groups?.find((y) => y.id === x.gid);
  if (!g) return null;
  const members = plan.units.filter((u) => g.memberIds.includes(u.id));
  const total = members.reduce((m, u) => m + (strengthBook(plan).get(u.id)?.effective ?? 0), 0);
  return (
    <div class="sect col s2-props">
      <b>Group · {members.length} elements · {total} all rks</b>
      <label class="field">
        Name
        <input
          disabled={x.p.readOnly}
          type="text"
          value={g.label}
          onInput={(ev) =>
            x.edit((pl) => {
              const y = pl.groups?.find((z) => z.id === g.id);
              if (y) y.label = ev.currentTarget.value;
            })
          }
        />
      </label>
      <div class="s2-chips">
        {members.map((u) => (
          <span class="s2-chip" onClick={() => x.onSelect({ units: [u.id], graphics: [] })}>
            {u.label}
          </span>
        ))}
      </div>
      <div class="dim small">Drag the dashed outline to move the whole group. Groups are task-org labels — no effect on the wargame.</div>
      {!x.p.readOnly && (
        <div class="row wrap">
          <button class="btn small" onClick={() => x.onSelect({ units: [...g.memberIds], graphics: [] })}>
            Select members
          </button>
          <button class="btn small danger" onClick={() => (x.commit((pl) => ungroup(pl, g.id)), x.onSelect({ units: [], graphics: [] }))}>
            Ungroup
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- task org

export function TaskOrg(x: { p: StepProps; sel: Selection; commit: Edit; onSelect: (s: Selection) => void }) {
  const plan = x.p.attempt.plan;
  const book = strengthBook(plan);
  const ro = x.p.readOnly;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const byId = new Map(plan.units.map((u) => [u.id, u]));
  const parentOf = (u: PlacedUnit) => (u.splitFrom && byId.has(u.splitFrom) ? u.splitFrom : u.parentId && byId.has(u.parentId) ? u.parentId : undefined);
  const childrenOf = (id: string, gid: string | undefined) => plan.units.filter((c) => parentOf(c) === id && c.groupId === gid);
  const roots = (gid: string | undefined) => plan.units.filter((u) => u.groupId === gid && (!parentOf(u) || byId.get(parentOf(u)!)!.groupId !== gid));
  const isDesc = (id: string, anc: string): boolean => {
    let cur = byId.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const pid = parentOf(cur);
      if (pid === anc) return true;
      cur = pid ? byId.get(pid) : undefined;
    }
    return false;
  };
  const dropOnUnit = (target: string) => {
    if (!drag || drag === target || isDesc(target, drag)) return;
    x.commit((pl) => {
      const u = pl.units.find((y) => y.id === drag);
      if (u && !u.splitFrom) u.parentId = target;
      else if (u) u.parentId = target;
    });
  };
  const dropOnGroup = (gid: string | undefined) => {
    if (!drag) return;
    x.commit((pl) => setGroup(pl, drag, gid));
  };
  const row = (u: PlacedUnit, depth: number): preact.JSX.Element => {
    const t = TEMPLATES[u.templateKey];
    const e = book.get(u.id);
    const pid = parentOf(u);
    const rel = u.splitFrom ? 'split' : pid && FOUND_ROLES.has(u.role) ? 'found' : pid ? 'att' : '';
    const kids = childrenOf(u.id, u.groupId);
    const sel = x.sel.units.includes(u.id);
    return (
      <>
        <div
          class={`s2-torow ${sel ? 'on' : ''} ${over === u.id ? 'drop' : ''}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          draggable={!ro}
          onDragStart={(ev) => {
            setDrag(u.id);
            ev.dataTransfer?.setData('text/plain', u.id);
          }}
          onDragEnd={() => (setDrag(null), setOver(null))}
          onDragOver={(ev) => {
            if (drag && drag !== u.id && !isDesc(u.id, drag)) {
              ev.preventDefault();
              setOver(u.id);
            }
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(ev) => {
            ev.preventDefault();
            dropOnUnit(u.id);
            setOver(null);
          }}
          onClick={() => x.onSelect({ units: [u.id], graphics: [] })}
          title={rel === 'found' ? `${foundTag(plan, u)}` : rel === 'split' ? 'Split element' : rel === 'att' ? 'Attached' : ''}
        >
          {depth > 0 && <span class="s2-tree">└</span>}
          {u.role === 'LP' || u.templateKey === 'LP' ? <span class="s2-oplp sm">▲</span> : isAreaUnit(u) ? <span class="s2-egg" /> : <Sym sidc={t.sidc} />}
          <span class="grow s2-tolabel">
            {u.label}
            {rel === 'found' && <span class="s2-from"> {foundTag(plan, u)}</span>}
            {rel === 'att' && <span class="dim"> att</span>}
          </span>
          <span class="s2-str" title={e && e.detached ? `${e.base} less ${e.detached} detached` : 'All ranks'}>
            {e?.effective ?? baseStrength(u)}
            {e && e.detached > 0 ? '(-)' : ''}
          </span>
        </div>
        {kids.map((k) => row(k, depth + 1))}
      </>
    );
  };
  const groups = plan.groups ?? [];
  const loose = roots(undefined);
  return (
    <div class="sect col s2-taskorg" style={{ gap: 4 }}>
      <div class="dim small" style={{ marginBottom: 4 }}>
        Click to select on the map. Drag a row onto a locality to attach it / set who finds it; onto a group header to move it between groups.
      </div>
      {groups.map((g) => (
        <div
          key={g.id}
          class={`s2-togroup ${over === g.id ? 'drop' : ''} ${x.sel.group === g.id ? 'on' : ''}`}
          onDragOver={(ev) => {
            if (drag) {
              ev.preventDefault();
              setOver(g.id);
            }
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(ev) => {
            ev.preventDefault();
            dropOnGroup(g.id);
            setOver(null);
          }}
        >
          <div class="s2-tohead" onClick={() => x.onSelect({ units: [], graphics: [], group: g.id })}>
            <span class="s2-egg grp" /> {g.label}
            <span class="right dim small">{g.memberIds.reduce((m, id) => m + (book.get(id)?.effective ?? 0), 0)} all rks</span>
          </div>
          {roots(g.id).map((u) => row(u, 0))}
        </div>
      ))}
      <div
        class={`s2-togroup loose ${over === '__none' ? 'drop' : ''}`}
        onDragOver={(ev) => {
          if (drag) {
            ev.preventDefault();
            setOver('__none');
          }
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(ev) => {
          ev.preventDefault();
          dropOnGroup(undefined);
          setOver(null);
        }}
      >
        {groups.length > 0 && <div class="s2-tohead">Not grouped</div>}
        {loose.map((u) => row(u, 0))}
        {!plan.units.length && <div class="dim small">No units sited yet.</div>}
      </div>
      <div class="dim small" style={{ marginTop: 6 }}>
        Total {[...book.values()].reduce((m, e) => m + e.effective, 0)} all rks in {plan.units.length} elements.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- symbol palette

export function SymbolPicker(x: { value: string | null; onPick: (it: PaletteItem | { id: string; name: string; kind: GraphicKind; subtype?: string }) => void }) {
  const [q, setQ] = useState('');
  const m = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const syms = SYMBOL_PALETTE.filter((s) => m(`${s.name} ${s.tags}`));
  const shapes = SHAPE_PALETTE.filter((s) => m(`${s.name} ${s.tags}`));
  return (
    <div class="col" style={{ gap: 6, marginTop: 8 }}>
      <input type="search" placeholder="Search symbols (OP, TRP, mine, abatis…)" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="s2-symgrid">
        {syms.map((s) => (
          <button key={s.id} class={x.value === s.id ? 'on' : ''} title={s.name} onClick={() => x.onPick(s)}>
            <img src={symbolSvg(s.sidc, 22)} alt="" />
            <span>{s.name}</span>
          </button>
        ))}
        {shapes.map((s) => (
          <button key={s.id} class={x.value === s.id ? 'on' : ''} title={`${s.name} — draw it on the map (click points, double-click to finish)`} onClick={() => x.onPick(s)}>
            <span class={`s2-shapeic ${s.id}`} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      {!syms.length && !shapes.length && <div class="dim small">Nothing matches “{q}”.</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------- QC sorties & checklist

export function QcSorties(x: { p: StepProps; commit: Edit }) {
  const { p } = x;
  const plan = p.attempt.plan;
  if (!p.s.own.resources.some((r) => r.templateKey === 'QC_DET')) return null;
  const areas = plan.graphics.filter((g) => g.kind === 'QC_AREA');
  const dDayN = Math.floor(p.s.times.hHour / 1440);
  const toInput = (t: number) => {
    const { hh, mm } = splitTime(t);
    return `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
  };
  return (
    <div class="sect col" style={{ gap: 8 }}>
      <h4>QC sorties (D Day, ~35 min each)</h4>
      {plan.qcSorties.map((q, i) => (
        <div class="row" key={i}>
          <input
            type="text"
            style={{ width: 70 }}
            disabled={p.readOnly}
            value={toInput(q.start)}
            title="HHMM on D Day"
            onChange={(e) => {
              const v = Number(e.currentTarget.value.replace(/\D/g, '').padStart(4, '0').slice(0, 4));
              x.commit((pl) => (pl.qcSorties[i].start = dDay(dDayN, v)));
            }}
          />
          <select disabled={p.readOnly} value={q.areaId} onChange={(e) => x.commit((pl) => (pl.qcSorties[i].areaId = e.currentTarget.value))}>
            {areas.map((a) => (
              <option value={a.id}>{a.props.label ?? 'QC area'}</option>
            ))}
          </select>
          {!p.readOnly && (
            <button class="btn small ghost" onClick={() => x.commit((pl) => pl.qcSorties.splice(i, 1))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {!areas.length && <div class="muted small">Mark a QC area on the map first.</div>}
      {areas.length > 0 && !p.readOnly && (
        <button class="btn small" onClick={() => x.commit((pl) => pl.qcSorties.push({ start: dDay(dDayN, 1800), areaId: areas[0].id }))}>
          + Add sortie
        </button>
      )}
      <div class="dim small">Times in {fmtTime(dDay(dDayN, 0)).split(' ').slice(0, 2).join(' ')} hrs (HHMM).</div>
    </div>
  );
}

export function Checklist(x: { p: StepProps }) {
  const { p } = x;
  const pl = p.attempt.plan;
  const has = (k: GraphicKind, f?: (g: PlanGraphic) => boolean) => pl.graphics.some((g) => g.kind === k && (!f || f(g)));
  const role = (r: string) => pl.units.some((u) => u.role === r);
  const lvl = p.s.level;
  const items: [string, boolean][] = [
    ['Line of FDLs marked', has('FDL')],
    ['Fwd & depth localities sited', role('FDL') && (lvl === 'PL' || role('DEPTH') || role('RES'))],
    ['Pri killing area', has('KILL_AREA')],
    ['DF (SOS)', has('DF', (g) => !!g.props.sos)],
    ['DFs on likely FAA/FUP/BOF', pl.graphics.filter((g) => g.kind === 'DF' && !g.props.sos).length >= 3],
    ['Obs (mfd / wire)', has('MINEFIELD') || has('WIRE') || has('OBSTACLE')],
    ...(lvl !== 'PL' ? ([['Standing ptl', role('SP_PTL')], ['C attk planned', has('CATK')], ['C pen posn', has('CPEN')]] as [string, boolean][]) : []),
    ...(lvl === 'COY' || lvl === 'PL' ? ([['LP(s)', role('LP')]] as [string, boolean][]) : []),
    ...(lvl !== 'PL' ? ([['Loc for screens', role('SCREEN')]] as [string, boolean][]) : []),
    ['SP / LP found from a locality', pl.units.filter((u) => u.role === 'SP_PTL' || u.role === 'LP').every((u) => !!u.parentId)],
    ['Altn posns', pl.units.some((u) => u.altPos)],
    ['HQ / CP sited', role('CHQ')],
    ...(p.s.own.resources.some((r) => r.templateKey === 'QC_DET') ? ([['QC area & sorties', has('QC_AREA') && pl.qcSorties.length > 0]] as [string, boolean][]) : []),
  ];
  const done = items.filter((i) => i[1]).length;
  return (
    <div class="sect">
      <h4>
        Completeness {done}/{items.length}
      </h4>
      <div class="muted small" style={{ marginBottom: 6 }}>
        Checks that items exist — not whether they are well sited. That is assessed after submission.
      </div>
      {items.map(([t, ok]) => (
        <div class="small" style={{ padding: '2px 0', color: ok ? '#8fdd92' : '#94a3af' }}>
          {ok ? '✔' : '○'} {t}
        </div>
      ))}
    </div>
  );
}
