# Terrain & Plan Analyser (training aid)

An automatic terrain and deployment analyser for **mountain border sectors**, used in the classroom to
compare a student's appreciation and deployment against a computed one. It runs on the **fictional sample
sectors** in `maps/mtn-*.json`; it is not an operational planning tool and the repository holds no real
terrain (NFR-02).

Open it from the home page (**Terrain & plan analyser**) or `#/analyser`. Pick a sector and a defence mode,
optionally **Draw AOI** (click the corners of the area of interest, then *Finish*), and press **Analyse**. The
analysis runs in a Web Worker (≈ 3 s for a 60 × 48 sector).

## What it computes

| Area | Feature | Method (all hex-based, 1 hex = 100 m) |
|---|---|---|
| Inputs | AOI boundary, mountain sectors, 3 sample sectors | Polygon over hex centres; sectors carry a border line and own / enemy reference points |
| Terrain | Slope, aspect, relief | Steepest neighbour rise; downslope direction |
| | Nullahs / valley floors | D6 flow accumulation ≥ `nullahMinCatchment` |
| | Ridgelines | Hexes higher than both neighbours on an axis by `ridgeMinRise_m`, joined into lines ≥ `ridgeMinLength` |
| | Dominance and terrain value | Height above the local mean; value = weighted dominance, observation of approaches and nullahs, defensibility (ground falling toward the enemy + cover), access from the rear |
| | Key ground (ITGs) | Highest-value hexes with spacing; extent = connected ground within `crestDrop_m` of the top; vital ground = best value × approach coverage |
| | Intervisibility / dead ground | Engine line of sight; viewshed on click; % of each approach not seen from key ground |
| | Approaches | Least-cost dismounted corridors from enemy depth to own depth (repeated with a separation penalty), width and capacity |
| Own deployment | Three modes | Forward, normal, normal defence in mountains — bands, post spacing, reserve depth in the params file |
| | ITG size → force | Extent hex count → section / platoon / company / battalion (`forceBySize`) |
| | Platoons, company HQs, Bn HQ, reserve, border posts | Platoons on key ground in the mode's band, then best remaining ground; HQs defiladed from enemy OPs; posts at approach crossings and at the mode's spacing |
| | Weapon siting | Each weapon placed near a platoon where it sees the most approach / infiltration ground within its effective range |
| | Mortars | Defiladed base plates; coverage and interlock (≥ 2 sections) of approach and infiltration ground |
| | Border surveillance | Union of post and platoon viewsheds; % observed and unobserved stretches |
| Enemy | Infiltration routes | Least-cost routes penalising night observation and favouring concealment |
| | Exploitable features | Approach crossings, ridges crossing the border, nullah heads at the border |
| | 3–4 attack options | Approach × objective combinations scored on objective value, dead ground, time, exposure and a covered FUP |
| Output | Ratings + recommendations | good / adequate / not good per ITG, position, weapon, mortar plan, surveillance; recommendations with grid references |
| | Spatial + quantitative | Map layers and tables |
| | Hand-over | GeoJSON (local grid metres) and CSV with grid references |

## Parameters

All numbers come from `data/analysis-mountain.json` (schema: `packages/engine/src/analysis/params.ts`). The
values in the repository are **placeholders** (approximate, open-source style). An institution replaces them
with its own doctrine figures (e.g. the Mountain Warfare GSP) in a data pack on its own server — never commit
restricted material to this repository. Additional files named `data/analysis-*.json` appear as extra
parameter sets. `npm run validate:data` checks them.
