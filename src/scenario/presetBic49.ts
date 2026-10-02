// Preset: "TE DEF – BIC 49" — Coy AOR, Comprehensive Def (Blueland vs Foxland).
// Recreated from the issued sketch (1 sq = 500 m, eastings 12-21, northings 64-83)
// and the student issue narrative. DS solution follows the SI&T Def Aprc guideline.

import type { Vec } from '../core/geom';
import { ellipsePoly } from '../core/geom';
import { dDay } from '../core/time';
import type { Feature, Scenario } from '../core/types';

const SQ = 500;
const E0 = 12;
const N0 = 64;
/** Grid (easting, northing) as on the sketch -> metres. */
const g = (e: number, n: number): Vec => ({ x: (e - E0) * SQ, y: (n - N0) * SQ });
const gp = (pts: [number, number][]): Vec[] => pts.map(([e, n]) => g(e, n));
const rect = (e0: number, n0: number, e1: number, n1: number): Vec[] => gp([[e0, n0], [e1, n0], [e1, n1], [e0, n1]]);
const blob = (e: number, n: number, rx: number, ry: number): Vec[] => ellipsePoly(g(e, n), rx * SQ, ry * SQ, 0, 14);

let fid = 0;
const id = () => `bic_f${++fid}`;

const features: Feature[] = [
  // ---- international border
  { id: id(), kind: 'border', name: 'Interstate Bdry', pts: gp([[12, 81.42], [13, 81.36], [14.5, 81.3], [16, 81.3], [17.5, 81.33], [19, 81.35], [20.3, 81.25], [21, 81.3]]) },

  // ---- water obstacles
  { id: id(), kind: 'nullah', name: 'Dry Nullah', width: 22, pts: gp([[12, 73.85], [12.6, 73.98], [13.5, 74.0], [14.4, 73.95], [14.95, 73.82], [15.5, 73.86], [16.2, 73.95], [16.6, 74.05], [17.5, 74.05], [18.5, 74.0], [19.5, 73.96], [20.2, 74.02], [21, 74.06]]) },
  { id: id(), kind: 'disty', name: 'Disty No 5', width: 10, pts: gp([[12, 69.72], [13, 69.8], [14, 69.88], [15, 69.94], [16, 69.95], [17, 69.95], [18, 69.96], [19, 69.97], [20, 69.97], [21, 69.98]]) },

  // ---- relative heights ("r")
  { id: id(), kind: 'height', name: '6 r', c: g(16.45, 80.2), rx: 0.45 * SQ, ry: 0.12 * SQ, rot: 0, h: 6 },
  { id: id(), kind: 'height', name: '9 r', c: g(15.55, 76.65), rx: 0.55 * SQ, ry: 0.14 * SQ, rot: 0, h: 9 },
  { id: id(), kind: 'height', name: '8 r', c: g(17.8, 76.85), rx: 0.6 * SQ, ry: 0.13 * SQ, rot: 0, h: 8 },
  { id: id(), kind: 'height', name: '15 r', c: g(15.5, 73.55), rx: 0.42 * SQ, ry: 0.11 * SQ, rot: 0, h: 15 },
  { id: id(), kind: 'height', name: 'Raised Gr', c: g(16.1, 72.28), rx: 0.55 * SQ, ry: 0.13 * SQ, rot: 0, h: 6 },
  { id: id(), kind: 'height', name: '17 r', c: g(15.55, 69.6), rx: 0.5 * SQ, ry: 0.12 * SQ, rot: 0, h: 17 },
  { id: id(), kind: 'height', name: '11 r', c: g(14.7, 66.3), rx: 0.5 * SQ, ry: 0.12 * SQ, rot: 0, h: 11 },
  { id: id(), kind: 'height', c: g(17.9, 67.45), rx: 0.5 * SQ, ry: 0.1 * SQ, rot: 0, h: 7 },
  { id: id(), kind: 'height', c: g(14.95, 81.15), rx: 0.35 * SQ, ry: 0.08 * SQ, rot: 0, h: 4 },
  { id: id(), kind: 'height', name: '10 r', c: g(20.85, 67.9), rx: 0.4 * SQ, ry: 0.1 * SQ, rot: 0, h: 10 },

  // ---- kidney bunds
  { id: id(), kind: 'kbund', name: 'Kidney Bund 1', c: g(17.65, 78.45), r: 0.38 * SQ, rot: 180 },
  { id: id(), kind: 'kbund', name: 'Kidney Bund 3', c: g(17.6, 69.5), r: 0.38 * SQ, rot: 180 },

  // ---- dunes / hummocks (black triangles on the sketch)
  { id: id(), kind: 'dunes', poly: blob(12.55, 79.65, 0.35, 0.1) },
  { id: id(), kind: 'dunes', poly: blob(17.25, 80.05, 0.4, 0.1) },
  { id: id(), kind: 'dunes', poly: blob(16.6, 77.05, 0.38, 0.1) },
  { id: id(), kind: 'dunes', poly: blob(17.65, 75.72, 0.38, 0.1) },
  { id: id(), kind: 'dunes', poly: blob(20.5, 80.1, 0.4, 0.1) },
  { id: id(), kind: 'dunes', poly: blob(20.75, 71.22, 0.35, 0.1) },

  // ---- trees / clumps
  { id: id(), kind: 'trees', name: 'Clump 2', poly: gp([[13.75, 76.65], [14.25, 76.6], [14.35, 77.0], [14.25, 77.45], [13.95, 77.5], [13.75, 77.1]]) },
  { id: id(), kind: 'trees', name: 'Clump 1', poly: blob(19.65, 76.62, 0.25, 0.22) },
  { id: id(), kind: 'trees', poly: blob(12.9, 72.6, 0.15, 0.18) },
  { id: id(), kind: 'trees', poly: blob(17.05, 71.3, 0.17, 0.15) },
  { id: id(), kind: 'trees', poly: blob(17.55, 68.25, 0.28, 0.12) },
  { id: id(), kind: 'trees', poly: blob(17.35, 66.6, 0.15, 0.17) },
  { id: id(), kind: 'trees', poly: blob(19.2, 67.3, 0.13, 0.13) },

  { id: id(), kind: 'broken', name: 'Broken Gr', poly: gp([[19.55, 74.8], [20.35, 74.85], [20.4, 75.45], [19.6, 75.5]]) },

  // ---- BUAs (Foxland)
  { id: id(), kind: 'bua', name: 'RAM', storeys: 1, poly: rect(14.5, 82.65, 14.78, 82.95) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(14.66, 82.25, 14.92, 82.6) },
  { id: id(), kind: 'bua', name: 'MOHALI', storeys: 1, poly: rect(19.1, 82.72, 19.42, 83.0) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(19.32, 82.3, 19.62, 82.65) },
  // ---- BUAs (Blueland)
  { id: id(), kind: 'bua', name: 'TANDA', storeys: 1, poly: rect(14.1, 78.05, 14.48, 78.36) },
  { id: id(), kind: 'bua', name: 'ALIABAD', storeys: 1, poly: rect(19.35, 78.05, 19.75, 78.36) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(19.8, 78.05, 20.2, 78.36) },
  { id: id(), kind: 'bua', name: 'ALIPUR', storeys: 2, poly: rect(17.0, 73.58, 17.36, 73.9) },
  { id: id(), kind: 'bua', storeys: 2, poly: rect(17.45, 73.58, 17.85, 73.9) },
  { id: id(), kind: 'bua', name: 'NASIRABAD', storeys: 1, poly: rect(19.55, 73.3, 19.95, 73.6) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(19.85, 73.56, 20.25, 73.86) },
  { id: id(), kind: 'bua', name: 'HUT', storeys: 1, poly: rect(14.25, 73.35, 14.55, 73.55) },
  { id: id(), kind: 'bua', name: 'DERA', storeys: 1, poly: rect(16.25, 71.0, 16.65, 71.45) },
  { id: id(), kind: 'bua', name: 'HAFIZABAD', storeys: 1, poly: rect(12.8, 71.15, 13.25, 71.45) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(13.2, 71.25, 13.6, 71.55) },
  { id: id(), kind: 'bua', name: 'ISLAMPUR', storeys: 1, poly: rect(19.4, 69.55, 19.85, 69.85) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(19.75, 69.45, 20.15, 69.75) },
  { id: id(), kind: 'bua', name: 'AZARA', storeys: 1, poly: rect(12.8, 67.85, 13.15, 68.15) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(13.2, 67.95, 13.6, 68.25) },
  { id: id(), kind: 'bua', name: 'KHAIRPUR', storeys: 1, poly: rect(16.1, 67.85, 16.5, 68.2) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(16.5, 67.7, 16.9, 68.0) },
  { id: id(), kind: 'bua', name: 'QASIMABAD', storeys: 1, poly: rect(17.3, 65.15, 17.75, 65.45) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(17.9, 65.1, 18.35, 65.4) },
  { id: id(), kind: 'bua', name: 'WAZIRABAD', storeys: 1, poly: rect(19.6, 65.7, 20.0, 66.0) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(20.05, 65.7, 20.5, 66.0) },
  { id: id(), kind: 'bua', storeys: 1, poly: rect(19.6, 65.25, 20.0, 65.55) },
  { id: id(), kind: 'bua', name: 'CHAK 18', storeys: 1, poly: rect(20.72, 74.75, 21.0, 75.15) },

  // ---- BOPs
  { id: id(), kind: 'bop', name: 'BOP 81', pos: g(14.85, 81.8), side: 'RED' },
  { id: id(), kind: 'bop', name: 'BOP 82', pos: g(19.0, 81.9), side: 'RED' },
  { id: id(), kind: 'bop', name: 'BOP 61', pos: g(14.75, 81.12), side: 'BLUE' },
  { id: id(), kind: 'bop', name: 'BOP 62', pos: g(18.75, 81.1), side: 'BLUE' },

  // ---- roads (metalled)
  { id: id(), kind: 'road', name: 'Rd Tanda - Khairpur - Qasimabad - Jaleelabad', cls: 'Cl 9 A 1', pts: gp([[14.3, 78.2], [14.35, 77.6], [14.4, 77.0], [14.55, 76.4], [14.9, 75.9], [15.0, 75.4], [15.0, 74.5], [14.97, 73.82], [15.0, 72.0], [15.03, 70.6], [15.03, 69.94], [15.05, 68.6], [15.1, 67.6], [15.6, 67.1], [16.3, 66.7], [17.0, 66.3], [17.6, 65.9], [18.1, 65.45], [18.25, 64.6], [18.25, 64.0]]) },
  { id: id(), kind: 'road', name: 'Rd Aliabad - Alipur - Islampur - Wazirabad', cls: 'Cl 30 A 1', pts: gp([[19.55, 78.0], [19.0, 77.4], [18.65, 76.4], [18.55, 75.4], [18.4, 74.6], [18.25, 73.9], [18.1, 73.0], [17.95, 72.3], [17.9, 71.6], [17.95, 70.8], [18.4, 70.72], [19.0, 70.6], [19.3, 69.97], [19.4, 69.4], [19.5, 68.5], [19.6, 67.5], [19.8, 66.8], [19.9, 66.2]]) },
  { id: id(), kind: 'road', name: 'Rd Chak 18 - Nasirabad - Jaleelabad', cls: 'Cl 30 A 1', pts: gp([[21, 77.1], [20.7, 76.4], [20.55, 75.4], [20.4, 74.4], [20.05, 73.4], [19.75, 72.5], [19.5, 71.5], [19.38, 70.6], [19.32, 69.97]]) },

  // ---- tracks (Cl 9 F 1)
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[13.45, 81.32], [13.4, 80.3], [13.0, 79.6], [12.0, 79.2]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[12, 77.8], [13, 77.86], [14.1, 78.15], [15.5, 78.2], [17, 78.25], [18.3, 78.15], [19.35, 78.15], [21, 78.3]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[14.75, 81.1], [14.6, 80.0], [14.45, 79.0], [14.35, 78.36]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[18.6, 81.05], [17.95, 79.4], [17.75, 78.5], [17.3, 77.3], [16.95, 76.2], [16.65, 75.2], [16.6, 74.1], [16.55, 73.0], [16.7, 72.1], [16.55, 71.45]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[16.55, 71.0], [16.85, 70.2], [16.75, 69.2], [16.5, 68.2]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[18.75, 81.15], [18.85, 82.0], [19.2, 82.75]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[14.85, 81.85], [14.8, 82.25]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[12, 72.9], [13.5, 72.95], [14.4, 73.35], [15.5, 73.3], [16.3, 73.4], [17.0, 73.62]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[17.85, 73.75], [18.8, 73.7], [19.55, 73.5]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[20.25, 73.5], [21, 72.9]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[12, 71.0], [12.8, 71.1], [13.6, 71.4], [14.6, 71.8], [15.4, 72.0], [16.25, 71.3]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[12, 67.8], [12.8, 68.0], [13.6, 68.1], [15.0, 68.05], [16.1, 68.0], [16.9, 67.8], [18.0, 67.9], [19.0, 68.4], [20.2, 68.8], [21, 68.9]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[20.6, 80.9], [19.9, 79.6], [19.62, 78.36]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[18.35, 65.3], [19.6, 65.85]]) },
  { id: id(), kind: 'track', cls: 'Cl 9 F 1', pts: gp([[15.0, 64.0], [15.6, 64.6], [16.6, 64.9], [17.3, 65.3]]) },

  // ---- bridges
  { id: id(), kind: 'bridge', name: 'Br 1', pos: g(14.97, 73.84), rot: 90 },
  { id: id(), kind: 'bridge', name: 'Br 2', pos: g(15.03, 69.94), rot: 90 },
  { id: id(), kind: 'bridge', name: 'Br 3', pos: g(19.31, 69.97), rot: 90 },
];

export function presetBic49(): Scenario {
  const light = { firstLight: 345, lastLight: 1125, moon: 'half' as const };
  return {
    id: 'preset_bic49_te_def',
    title: 'TE DEF – BIC 49',
    subtitle: 'Coy AOR — Comprehensive Def (A Coy 139 Baloch)',
    level: 'COY',
    source: 'preset',
    seed: 4949,
    createdAt: Date.UTC(2026, 0, 1),
    terrain: { width: 9 * SQ, height: 19 * SQ, cell: 25, gridSq: SQ, gridOrigin: { e: E0, n: N0 }, features, type: 'PLAINS' },
    narrative: [
      { key: 'aim', title: 'Aim', body: 'To train student offrs about Conduct of Def incl Sel & Occupation of Def, Siting of Wpns & incorporating Surv Plan under MDO envmt.' },
      { key: 'gen_idea', title: 'Gen Idea', body: "Blueland (BL) and Foxland (FL) are two neighbouring states with their interstate bdry as shown on sketch. Relations b/w the two states have remained strained due to ideological diff and long outstanding territorial disputes ever since their independence. Sit has been further aggravated by recent suicidal attk on FL's mil cny in Pahlgham. FL without a second thought has deemed BL resp for the incident. In order to gain the sympathies of her masses, FL has conc its forces all along the border and war seems imminent.\n\nReportedly, FL is prep to launch an attk along axis Gandhi Nagar - Quaidabad with a view to threaten Quaidabad which is an imp comm cen (loc 12 KMs South of sketch). Conc of a Bde plus size force with a sqn armr is reported in area Gandhi Nagar (10 KMs North of sketch). The attk of en is expected any time after D Day." },
      { key: 'narr_bde', title: 'Narr', body: 'As a sequel to these devs, Comd 250 Bde (resp for the def of Quaidabad Sec) has tasked CO 139 Baloch, presently conc at Quaidabad, to take up def from excl Hafizabad to incl Hayatabad and ensure max attrition to the en.\n\nFAF enjoys air superiority however; BAF is likely to provide CS and recce sorties during critical stages of the battle.\n\nMet. Actual.' },
      { key: 'narr_co', title: 'CO’s O Gp', body: 'CO 139 Baloch called his O gp at Quaidabad on D - 3 (today) at 1000 hrs and said, “Gentlemen, we have received formal OOs from Bde HQ. As per Bde Comd’s vis, en is prep to attk our posns any time after first lt D Day with a bde plus size force sp by an armr sqn.”\n\nMsn. Take up def posn from excl Hafizabad to incl Hayatabad.\n\nExec — Gen Outline. Def will be taken with two coys up as fol:-\n    Lt Fwd   -  A Coy (Own Coy)\n    Rt Fwd   -  B Coy\n    Lt Depth -  C Coy\n    Rt Depth -  D Coy' },
      { key: 'atts', title: 'Atts and Dets', body: 'UC   -  Pl LAT ex 127 Baloch\n         Pl ex 105 Fd Engrs\nDS   -  P Bty 112 Fd Regt Arty\nIn Sp -  112 Fd Regt Arty less P Bty' },
      { key: 'exec', title: 'Exec (Coy Tasks)', body: 'A Coy — Gp: Narr 1. Tasks: Narr 1.\n\nB Coy — Gp: Normal. Tasks: Take up def posns within given bdrys by 1st lt D Day. Def line to conform with the FDLs of A Coy.\n\nC Coy — Gp: Normal. Tasks: Take up def posns within given bdrys; def to be ready by first lt D Day; send a Pl size Bn Screens in consultation with Coy Comd A Coy; be prep to launch C attk on orders; be prep to occupy C pen posns on orders.\n\nD Coy — Gp: Normal. Tasks: Take up def posns within given bdrys; def to be ready by first lt D Day; be prep to launch C attk on orders; be prep to occupy C pen posns on orders.' },
      { key: 'topo', title: 'Topo Notes', body: 'The AOO resembles the plains of Punjab. The area is gen flat, open and extensively cultivated. The soil is firm and x-cty mov is possible during dry weather, however, during rainy season, it is restd to existing rds and trs. The area is criss crossed with numerous rds / trs inter connecting various vills and towns in the area. F of F and obsn is aval upto 800 - 1500 ms.\n\nRds / Trs\n  Rd Aliabad - Alipur - Islampur - Wazirabad  -  Cl 30 A 1\n  Rd Chak 18 - Nasirabad - Jaleelabad  -  Cl 30 A 1\n  Rd Tanda - Khairpur - Qasimabad - Jaleelabad  -  Cl 9 A 1\n  All Trs  -  Cl 9 F 1\n\nObs\n  Broken Gr. Complete obs for wh vehs, however, impedes mov of tr vehs.\n  Disty No 5. Not an obs for wh and tr vehs however impedes mov.\n  Dry Nullah. Not an obs for wh and tr vehs however impedes mov.\n  BUAs. Area is densely populated. The vills / towns are loc gen on the higher gr than surroundings. Jaleel Abad is med size town with double storied houses.\n\nCover. Cover is aval in the form of scattered trees, clumps, relative hts and BUAs.' },
      { key: 'narr1', title: 'Narr 1', body: 'CO (depicted by syn Instr) turned towards Coy Comd A Coy, Capt Hasnain, and said, “I have given you the most difficult and complex task of def lt side of my Bn. As per my vis en will attk your coy loc with a bn size force sp by a tp of tks. You are at full liberty to sel and suggest to me suitable lines of def within given bdrys. Plan your defs in such a manner that it should prevent, resist, repulse and destroy en attk. 1 x Intg QC Det (5 x pers having 1 surv x QC & 1 x A/QC), 2 x BS dets & Sec aslt pnr are placed UC whereas Arty & Mor Obsrs are placed UC forthwith. Moreover, UCAV strike would also be aval on justified demand.\n\nYou must sel and suggest loc for Bn Screens and lve enough space for their emp as the resources do not warrant emp of any other protective dets while ensuring def to be as far fwd as tac feasible. B Coy will conform to the def line sel by you as FDLs. Your defs should be ready in all aspects by first lt D Day.”' },
    ],
    requirements: [
      'As Coy Comd A Coy, carry out a detailed aprc: aim, gr & weather, ident of lines of def (mk on sketch).',
      'DPs incl emp and siting of maj wpns (RRs, BS, GLHMG, MGs, 60mm mors).',
      'Options aval to en (min two APs) — record the en most likely apch.',
      'Mk the plan: localities, FDLs, killing areas, obs plan (mfds/wire), DF & DF (SOS), surv plan (standing ptl, LP, OP, QC), C attk objs in order of pri, CHQ/CP, altn posns, loc for Bn screens.',
      'Pre-plan contingencies: screen battle, en recce, en assembly/forming up (spoiling attk), assault (readjustment), loss of LMG bkr/sec (local C attk), loss of a pl (C pen / Bn C attk), reorg.',
    ],
    own: {
      formation: 'A Coy 139 Baloch',
      higher: '139 Baloch / 250 Bde',
      aor: gp([[14, 68.0], [19, 68.0], [19, 81.33], [14, 81.3]]),
      boundaries: [
        { pts: gp([[14, 64], [14, 81.3]]), label: '105 ✕ 250', echelon: 'BDE' },
        { pts: gp([[19, 64], [19, 81.35]]), label: 'A | B', echelon: 'COY' },
      ],
      flanks: [
        { side: 'L', name: '105 Bde (inter bde bdry)' },
        { side: 'R', name: 'B Coy 139 Baloch' },
      ],
      resources: [
        { templateKey: 'RIFLE_PL', count: 3, status: 'ORGANIC', note: 'Nos 1, 2 & 3 Pls' },
        { templateKey: 'CHQ', count: 1, status: 'ORGANIC' },
        { templateKey: 'CP', count: 1, status: 'ORGANIC' },
        { templateKey: 'RR_DET', count: 2, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'MOR60_SEC', count: 1, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'GLHMG_DET', count: 1, status: 'ORGANIC', note: 'Wpn sec' },
        { templateKey: 'RIFLE_SEC', count: 1, status: 'ORGANIC', note: 'Standing ptl (found from depth pl)' },
        { templateKey: 'LP', count: 2, status: 'ORGANIC', note: 'Found from fwd pls (ni)' },
        { templateKey: 'SCREEN_PL', count: 1, status: 'IN_SP', note: 'Bn screen ex C Coy — sel & suggest loc' },
        { templateKey: 'BS_DET', count: 2, status: 'UC' },
        { templateKey: 'ASLT_PNR_SEC', count: 1, status: 'UC' },
        { templateKey: 'QC_DET', count: 1, status: 'UC', note: '1 x surv QC, 1 x A/QC' },
        { templateKey: 'ARTY_OBS', count: 1, status: 'UC', note: 'ex P Bty 112 Fd Regt' },
        { templateKey: 'MOR_OBS', count: 1, status: 'UC', note: 'Bn 81mm mors' },
      ],
      fire: { artyBatteries: 3, artyCalibre: '105', artyLabel: 'P Bty (DS) + 112 Fd Regt less P Bty (in sp)', mor81: true, ucavSorties: 1, mines: { apM: 600, atM: 300 }, wireM: 800 },
    },
    enemy: {
      name: 'Foxland Bn Gp',
      force: [
        { templateKey: 'EN_RECCE', count: 2 },
        { templateKey: 'EN_INF_COY', count: 4 },
        { templateKey: 'EN_SUPPORT_COY', count: 1 },
        { templateKey: 'EN_TK_TP', count: 1 },
        { templateKey: 'EN_ENGR', count: 1 },
      ],
      entry: [g(14.8, 82.4), g(16.9, 82.3), g(19.3, 82.4)],
      attackAtNight: true,
      ewThreat: 'MED',
      airThreat: 'HIGH',
      artyBatteries: 2,
    },
    times: {
      now: dDay(-3, 1200),
      defReady: dDay(0, 545),
      enCrossBorder: dDay(0, 545),
      hHour: dDay(0, 2100),
      end: dDay(1, 300),
      light,
    },
    weather: { cond: 'clear', going: 'dry', temp: '28-36 °C', wind: 'Lt, NW', vis: 1 },
    ds: {
      approaches: [
        {
          id: 'apch_l', name: 'Western (Lt) Apch', flank: 'L', pri: 1, tankGoing: 'good', capacity: 'Bn sp by a tp of armr',
          path: gp([[14.8, 82.3], [14.6, 80.0], [14.35, 78.4], [14.4, 77.0], [14.9, 75.9], [15.0, 74.5], [15.2, 73.4], [15.7, 72.4], [16.3, 71.3]]),
          notes: ['Originates from Ram, passes through BOP 81/61, Tanda, Clump 2 and Br 1 along Rd Tanda - Khairpur (Cl 9 A 1).', 'Dir keeping easy (rd, Clump 2, 9 r).', 'Covered depl areas: Tanda, Clump 2; BOF possible at 9 r.', 'Armr can be emp in close sp; exploits the inter bde gap.'],
        },
        {
          id: 'apch_c', name: 'Central Apch', flank: 'C', pri: 2, tankGoing: 'fair', capacity: 'Bn (-) sp by tks',
          path: gp([[16.9, 82.3], [16.6, 80.6], [17.2, 79.2], [17.0, 77.6], [16.7, 76.0], [16.4, 74.3], [16.2, 72.8], [16.4, 71.3]]),
          notes: ['Originates from BOP 61/62 gap, passes 6 r, Kidney Bund 1, between 9 r and 8 r, across Dry Nullah W of Alipur to Raised Gr.', 'Open gr, little cover; mutually sp by Lt apch.'],
        },
        {
          id: 'apch_r', name: 'Eastern (Rt) Apch', flank: 'R', pri: 3, tankGoing: 'good', capacity: 'Bn sp by tks (shared with B Coy)',
          path: gp([[19.3, 82.4], [18.8, 81.0], [19.4, 78.5], [19.0, 77.4], [18.6, 76.2], [18.45, 74.8], [18.2, 73.5], [17.95, 72.0], [17.9, 70.8]]),
          notes: ['Originates from Mohali, passes BOP 82/62, Aliabad, Clump 1 along Rd Aliabad - Alipur (Cl 30 A 1).', 'Lies along inter coy bdry — coord with B Coy.'],
        },
      ],
      itgs: [
        { id: 'itg_15r', name: '15 r', pos: g(15.5, 73.55), pri: 1, vital: true, notes: 'Dominates Br 1, Rd Tanda - Khairpur and the Lt apch; Dry Nullah in front as obs.' },
        { id: 'itg_alipur', name: 'Alipur', pos: g(17.4, 73.75), pri: 2, notes: 'Double storied BUA astride Cl 30 rd; dominates Cen and Rt apchs.' },
        { id: 'itg_raised', name: 'Raised Gr', pos: g(16.1, 72.28), pri: 3, notes: 'Provides depth to 15 r and Alipur; confluence of Lt and Cen apchs.' },
        { id: 'itg_dera', name: 'Dera', pos: g(16.45, 71.22), pri: 4, notes: 'Depth BUA; suitable for CHQ.' },
        { id: 'itg_9r', name: '9 r', pos: g(15.55, 76.65), pri: 5, notes: 'Fwd dominating feature; screen posn / likely en BOF.' },
        { id: 'itg_8r', name: '8 r', pos: g(17.8, 76.85), pri: 6, notes: 'Fwd feature on Cen/Rt apchs; screen posn.' },
        { id: 'itg_17r', name: '17 r', pos: g(15.55, 69.6), pri: 7, notes: 'Rear feature behind Disty No 5.' },
      ],
      linesOfDef: [
        { id: 'line_y', name: 'Line Y: 15 r – Alipur (Dry Nullah)', pts: gp([[15.1, 73.6], [15.5, 73.55], [16.4, 73.6], [17.4, 73.75], [18.3, 73.75]]), itgIds: ['itg_15r', 'itg_alipur'], pri: 1 },
        { id: 'line_x', name: 'Line X: 9 r – 8 r', pts: gp([[15.0, 76.65], [15.55, 76.65], [16.6, 76.8], [17.8, 76.85], [18.4, 76.85]]), itgIds: ['itg_9r', 'itg_8r'], pri: 2 },
        { id: 'line_z', name: 'Line Z: Raised Gr – Dera', pts: gp([[15.3, 72.3], [16.1, 72.28], [16.45, 71.22], [17.9, 71.6]]), itgIds: ['itg_raised', 'itg_dera'], pri: 3 },
        { id: 'line_w', name: 'Line W: 17 r – Kidney Bund 3 (Disty No 5)', pts: gp([[15.0, 69.6], [15.55, 69.6], [17.6, 69.5], [18.6, 69.6]]), itgIds: ['itg_17r'], pri: 4 },
      ],
      recommendedFdl: 'line_y',
      recommendedDepth: 'line_z',
      screenArea: { name: '9 r – 8 r', pos: g(16.7, 76.75) },
      likelyFAAs: [
        { name: 'Tanda', pos: g(14.3, 78.2), approachId: 'apch_l' },
        { name: 'Kidney Bund 1', pos: g(17.65, 78.6), approachId: 'apch_c' },
        { name: 'Aliabad', pos: g(19.7, 78.2), approachId: 'apch_r' },
      ],
      likelyFUPs: [
        { name: 'Clump 2', pos: g(14.05, 77.0), approachId: 'apch_l' },
        { name: 'Dunes S of 8 r', pos: g(17.1, 76.0), approachId: 'apch_c' },
        { name: 'Clump 1', pos: g(19.6, 76.6), approachId: 'apch_r' },
      ],
      likelyBOFs: [
        { name: '9 r', pos: g(15.55, 76.65), approachId: 'apch_l' },
        { name: '8 r', pos: g(17.8, 76.85), approachId: 'apch_c' },
      ],
      notes: [
        'Pri of apchs: Lt (Western) > Cen > Rt — ease of dir keeping, good tfc (Cl 9 A 1), armr in CS, covered depl areas (Tanda, Clump 2), BOF at 9 r, exploits inter bde gap.',
        'Pri of ITGs: 15 r > Alipur > Raised Gr > Dera > 9 r > 8 r.',
        'Lines of def: Y (15 r – Alipur, Dry Nullah in front) > X (9 r – 8 r) > Z (Raised Gr – Dera) > W (Disty No 5).',
        'DP-1: FDLs on Line Y (pl each at 15 r and Alipur), depth pl Raised Gr; Bn screens on Line X (9 r – 8 r); bias and A tk def Lt.',
        'Killing areas: pri — Br 1 / Rd Tanda - Khairpur N of Dry Nullah (sq 1474, 1574); sec — W of Alipur (sq 1674).',
        'Surv: standing ptl area Clump 2 (likely FUP), LP fwd of Dry Nullah, arty obsr 15 r, mor obsr Alipur; QC over Tanda – Clump 2 – 9 r.',
        'DF (SOS) arty: Br 1 / N of 15 r; DFs: Clump 2, 9 r, Tanda, Kidney Bund 1, Clump 1.',
        'C attk objs in order of pri: 15 r, Alipur — by depth pl from Raised Gr within 15-20 min.',
        'CHQ Dera (in line with depth pl, covered, near main route); CP 15 r.',
        'En AP-1: after pushing back screens by mid-day, bn attk after last lt on Lt apch — FAA Tanda, FUP Clump 2, BOF 9 r, tks in CS; Ph 1 on 15 r & Hut, Ph 2 on Raised Gr.',
      ],
    },
  };
}
