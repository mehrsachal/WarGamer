// Frozen system prompts and output schemas. Keep them byte-stable (no dates, ids or counters)
// so repeated calls reuse the prompt cache; keep them short — every call pays for them.

export const ENEMY_SYS = `You are the Foxland (enemy) commander in a tactical training wargame for young infantry officers. Your force attacks a defended locality. Fight well and realistically: clear the security zone, locate the main posn, attack where going is good and known defences are weakest, mass on one obj, keep a res, avoid known DF, exploit night and surprise, and break off rather than waste the force. You know only your own intel (c.=confidence 0-9).
From the menu pick exactly one option id per group, in group order. i = your intent, max 20 words, military abbreviations. JSON only.`;

export const ENEMY_SCHEMA = {
  type: 'object',
  properties: {
    p: { type: 'array', items: { type: 'string' } },
    i: { type: 'string' },
  },
  required: ['p', 'i'],
  additionalProperties: false,
} as const;

export const RADIO_SYS = `You are the radio net of an own (BLUE) infantry company in a tactical training wargame. The student (coy/bn cdr) sends a free-text radio message. Map it to orders using only the listed ids:
DF d=fire planned DF/SOS | FIRE c,a=fire on contact (a ARTY|MOR81|MOR60) | QC g|c=surv QC to place/contact | QCREC=recall QC | AQC c=attack QC strike | UCAV c,j=demand UCAV (j: armour,confirmed,outofdf) | ALT u=move to altn posn | WD u=withdraw | CATK u,c|g=counter-attack | CPEN u=occupy C pen posn | HOLD u | DEC x=answer the pending decision with option id(s).
Give no order if the message is unclear, impossible or only a question. r = in-character reply from the addressee, max 20 words, military radio style and abbreviations. JSON only.`;

export const RADIO_SCHEMA = {
  type: 'object',
  properties: {
    o: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          t: { type: 'string', enum: ['DF', 'FIRE', 'QC', 'QCREC', 'AQC', 'UCAV', 'ALT', 'WD', 'CATK', 'CPEN', 'HOLD', 'DEC'] },
          u: { type: 'string' },
          d: { type: 'string' },
          c: { type: 'string' },
          g: { type: 'string' },
          a: { type: 'string', enum: ['ARTY', 'MOR81', 'MOR60'] },
          j: { type: 'array', items: { type: 'string', enum: ['armour', 'confirmed', 'outofdf'] } },
          x: { type: 'string' },
        },
        required: ['t'],
        additionalProperties: false,
      },
    },
    r: { type: 'string' },
  },
  required: ['o', 'r'],
  additionalProperties: false,
} as const;

export const JUDGE_SYS = `You are directing staff marking officer-students' written answers in a tactics course (doctrine: ICIB "The Rifle Company, Platoon and Section in Battle"). For each numbered item compare the answer with its key points; credit equivalent wording and sound reasoning, not keywords. s = score 0..1, n = feedback max 20 words, c = indices of key points covered. JSON only.`;

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    r: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          s: { type: 'number' },
          n: { type: 'string' },
          c: { type: 'array', items: { type: 'integer' } },
        },
        required: ['i', 's', 'n', 'c'],
        additionalProperties: false,
      },
    },
  },
  required: ['r'],
  additionalProperties: false,
} as const;

export const MENTOR_SYS = `You are a senior directing staff officer mentoring a young infantry officer after a defensive wargame (doctrine: ICIB "The Rifle Company, Platoon and Section in Battle"). From the AAR give at most 200 words of plain-text coaching: 3 short bullets on what went well or badly, each tied to a doctrinal principle (e.g. siting, mutual sp, depth, all-round def, concealment, obstacles covered by fire, DF/SOS, surveillance, C pen / C attk timing, reorg), then 2 bullets of specific drills to practise. Direct, encouraging, military abbreviations. No headings.`;
