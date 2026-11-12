// Runs the terrain & plan analyser off the UI thread.
import { type AnalysisParams, type DataBundle, type DefenceMode, type GameMap, type Hex, MapModel, Ruleset, analyse } from '@tht/engine';

export interface AnalyseRequest {
  id: number;
  map: GameMap;
  data: DataBundle;
  params: AnalysisParams;
  mode: DefenceMode;
  aoi?: Hex[];
}

let cache: { data: Ruleset; map: MapModel; mapId: string } | null = null;

self.onmessage = (e: MessageEvent<AnalyseRequest>) => {
  const q = e.data;
  try {
    if (!cache || cache.mapId !== q.map.id) {
      const data = Ruleset.parse(q.data);
      cache = { data, map: new MapModel(q.map, data), mapId: q.map.id };
    }
    const report = analyse({ map: cache.map, data: cache.data, params: q.params, mode: q.mode, aoi: q.aoi, now: () => performance.now() });
    (self as unknown as Worker).postMessage({ id: q.id, report });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: q.id, error: (err as Error).message });
  }
};
