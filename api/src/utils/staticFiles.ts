// Memoized static-file reader: reads each file once from disk, then serves from
// memory. Falls back to a fresh disk read if the file's mtime changed (hot edits).
import { readFileSync, statSync } from 'fs';

interface CacheEntry {
  content: Buffer;
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

export function readStaticFile(path: string): Buffer {
  const cached = cache.get(path);
  const mtimeMs = statSync(path).mtimeMs;
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.content;
  }
  const content = readFileSync(path);
  cache.set(path, { content, mtimeMs });
  return content;
}

export function readStaticFileString(path: string): string {
  return readStaticFile(path).toString('utf-8');
}
