// Types for lan-core.cjs (used by the tests; the desktop app and CLI are plain JS).
import type { Server } from 'node:http';

export interface LanServerOptions {
  port?: number;
  portRetries?: number;
  host?: string;
  dataDir: string;
  distDir: string;
  log?: (msg: string) => void;
}
export interface LanServer {
  readonly STORES: string[];
  readonly dataFile: string;
  readonly server: Server;
  readonly port: number | null;
  start(): Promise<number>;
  urls(): string[];
  importMissing(data: Record<string, { id: string }[]>): Record<string, number>;
  counts(): Record<string, number>;
  flush(): void;
  stop(): Promise<void>;
}
export declare function createLanServer(o: LanServerOptions): LanServer;
export declare function lanAddresses(): string[];
export declare const STORES: string[];
export declare const ASSET_RE: RegExp;
export declare const MIME: Record<string, string>;
