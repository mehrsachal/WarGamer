// Parameters for the terrain & plan analyser. Every number lives in data/analysis-mountain.json so that the
// institution can replace the placeholder values with those of its own doctrine (e.g. the Mountain Warfare GSP)
// on its own server, without code changes.
import { z } from 'zod';

const range = z.tuple([z.number(), z.number()]);
const Mode = z.object({
  label: z.string(),
  description: z.string(),
  /** Distance band (m) from the border in which the main defensive positions are sited. */
  mainPositions_m: range,
  /** Spacing (m) of posts along the border. */
  postSpacing_m: z.number().min(100),
  /** Distance band (m) from the border for posts. */
  posts_m: range,
  /** Prefer ridges / spurs for positions (mountain defence). */
  preferRidges: z.boolean(),
  /** Always put a post where an approach crosses the border (passes, nullah heads). */
  postsAtCrossings: z.boolean(),
  /** Depth (m) behind the border for the reserve. */
  reserveDepth_m: z.number(),
});

export const AnalysisParams = z.object({
  source: z.string(),
  terrain: z.object({
    /** Radius (hexes) for the dominance (relative height) calculation. */
    dominanceRadius: z.number().int().min(2),
    /** Catchment (hexes draining into a hex) above which it is a nullah / valley floor. */
    nullahMinCatchment: z.number().int().min(3),
    /** Height (m) a hex must stand above both neighbours on an axis to count as ridge. */
    ridgeMinRise_m: z.number().min(0),
    /** Minimum hexes for a ridgeline to be reported. */
    ridgeMinLength: z.number().int().min(2),
    /** Observation range (hexes) used for viewsheds of ground. */
    observationRange: z.number().int().min(3),
    /** Weights for the terrain-value score (sum is normalised). */
    valueWeights: z.object({ dominance: z.number(), observation: z.number(), defensibility: z.number(), access: z.number() }),
  }),
  itg: z.object({
    maxItgs: z.number().int().min(1),
    minSpacing_hex: z.number().int().min(1),
    /** Minimum terrain value (0..1) for key ground. */
    minValue: z.number().min(0).max(1),
    /** Ground within this drop (m) of the top, connected to it, makes up the feature. */
    crestDrop_m: z.number().min(5),
    /** Force needed to hold ground of a given extent (hexes), smallest first. */
    forceBySize: z.array(z.object({ maxHexes: z.number().int(), force: z.enum(['section', 'platoon', 'company', 'battalion']) })).min(1),
    /** Distance (hexes) within which two positions can support each other. */
    mutualSupport_hex: z.number().int().min(1),
  }),
  approaches: z.object({
    max: z.number().int().min(1),
    /** Cost multiplier applied near earlier approaches to force distinct corridors. */
    separationPenalty: z.number().min(1),
    separation_hex: z.number().int().min(1),
    /** Minutes per move point for dismounted troops (time & space). */
    minutesPerMP: z.number().min(0.1),
  }),
  infiltration: z.object({
    routes: z.number().int().min(1),
    /** Extra cost factor for a hex seen by own troops (infiltrators avoid observation). */
    exposurePenalty: z.number().min(0),
    /** Range (hexes) at which own positions are assumed to observe at night. */
    nightObservation_hex: z.number().int().min(1),
  }),
  modes: z.object({ forward: Mode, normal: Mode, mountain: Mode }),
  force: z.object({
    label: z.string(),
    companies: z.number().int().min(1),
    platoonsPerCompany: z.number().int().min(1),
    reserveCompanies: z.number().int().min(0),
    /** Support weapons available, by weapon id from data/weapons.json. */
    weapons: z.record(z.string(), z.number().int().min(0)),
    /** Mortar sections, by weapon id. */
    mortars: z.record(z.string(), z.number().int().min(0)),
    /** Company HQ distance (m) behind its forward platoons. */
    coyHqDepth_m: range,
  }),
  surveillance: z.object({
    /** Day observation range (hexes) of a post / position along the border. */
    range_hex: z.number().int().min(1),
    /** Length (m) of unobserved border above which a gap is reported. */
    minGap_m: z.number().min(0),
  }),
  ratings: z.object({
    good: z.number().min(0).max(1),
    adequate: z.number().min(0).max(1),
  }),
});
export type AnalysisParams = z.infer<typeof AnalysisParams>;
export type DefenceMode = 'forward' | 'normal' | 'mountain';
