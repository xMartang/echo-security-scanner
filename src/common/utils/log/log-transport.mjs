/**
 * Pino worker-thread transport.
 *
 * Each log file receives its named level AND everything above it:
 *   - ${serviceName}.debug.log  (level >= 20 -- all records)
 *   - ${serviceName}.info.log   (level >= 30 -- info, warn, error, fatal)
 *   - ${serviceName}.error.log  (level >= 50 -- error, fatal)
 *
 * File naming: the active file has no numeric suffix.
 * On each rotation a numeric suffix is appended to the archive:
 *   bullmq.debug.log        <- current (always)
 *   bullmq.debug.log.1      <- most-recent archive
 *   bullmq.debug.log.2      <- older archive
 *   ...                       (up to maxFiles archives retained)
 *
 * Streams are lazily created on first write for each level so no empty
 * files are left behind for levels that receive no records.
 */

import { createStream } from 'rotating-file-stream';
import pino from 'pino';
import { mkdir } from 'node:fs/promises';
import { Writable } from 'node:stream';

const { values: LOG_LEVELS, labels: LOG_LABEL } = pino.levels;

export default async function transport(opts) {
  const { dir = './logs/local', serviceName = 'app' } = opts;

  await mkdir(dir, { recursive: true });

  // Lazy stream cache -- created synchronously on first write per level.
  const streams = { debug: null, info: null, error: null };

  function getStream(levelKey) {
    if (!streams[levelKey]) {
      // index === null -> active file (no suffix)
      // index > 0      -> archived file (.1, .2, ...)
      streams[levelKey] = createStream(
        (index) => index === null
          ? `${serviceName}.${levelKey}.log`
          : `${serviceName}.${levelKey}.log.${index}`,
        { size: '50M', maxFiles: 5, path: dir },
      );
    }
    return streams[levelKey];
  }

  /**
   * Cumulative routing -- each file receives its level AND all levels above it.
   *
   *  debug.log  <- everything  (level >= debug)
   *  info.log   <- info+       (level >= info,  includes warn / error / fatal)
   *  error.log  <- error+      (level >= error, includes fatal)
   */
  function route(level, output) {
    if (level >= LOG_LEVELS.debug) getStream('debug').write(output);
    if (level >= LOG_LEVELS.info)  getStream('info').write(output);
    if (level >= LOG_LEVELS.error) getStream('error').write(output);
  }

  return new Writable({
    write(chunk, _encoding, callback) {
      const line = chunk.toString().trim();
      if (!line) { callback(); return; }

      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        callback();
        return;
      }

      const numericLevel = obj.level;
      const formattedLog = { ...obj, level: LOG_LABEL[numericLevel] ?? String(numericLevel) };
      route(numericLevel, JSON.stringify(formattedLog) + '\n');

      callback();
    },

    final(callback) {
      const active = Object.values(streams).filter(Boolean);
      if (active.length === 0) { callback(); return; }
      let remaining = active.length;
      function done() { if (--remaining === 0) callback(); }
      active.forEach((s) => s.end(done));
    },
  });
}
