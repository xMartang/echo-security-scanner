/**
 * Pino worker-thread transport.
 *
 * Each log file receives its named level AND everything above it:
 *   - ${serviceName}.debug.{n}.log  (level >= 20 — all records)
 *   - ${serviceName}.info.{n}.log   (level >= 30 — info, warn, error, fatal)
 *   - ${serviceName}.error.{n}.log  (level >= 50 — error, fatal)
 *
 * This mirrors the "lower files are supersets" convention so operators can
 * grep debug.log for the full picture or error.log for just failures.
 *
 * Streams are lazily created on first write for each level so no empty
 * files are left behind for levels that receive no records.
 *
 * pino-roll appends a sequence number to the base path; e.g.:
 *   api.debug.1.log, api.debug.2.log, … (daily + 50 MB rotation, 7 files)
 */

import pino from 'pino';
import roll from 'pino-roll';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';

const { values: LOG_LEVELS } = pino.levels;
// LOG_LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }

export default async function transport(opts) {
  const { dir = './logs/local', serviceName = 'app' } = opts;

  await mkdir(dir, { recursive: true });

  const rollOpts = {
    frequency: 'daily',
    size: '50m',
    extension: '.log',
    limit: { count: 5 },
    mkdir: true,
  };

  // Lazy stream cache — created on first write so no empty files are produced.
  const streams = { debug: null, info: null, error: null };
  // Writes that arrive while a stream is still being initialised.
  const pending = { debug: [], info: [], error: [] };
  // In-flight init promises — one per level key, prevents duplicate roll() calls.
  const init = { debug: null, info: null, error: null };

  async function getStream(levelKey) {
    if (streams[levelKey]) return streams[levelKey];
    if (!init[levelKey]) {
      init[levelKey] = roll({ file: join(dir, `${serviceName}.${levelKey}`), ...rollOpts })
        .then((s) => {
          streams[levelKey] = s;
          // Drain writes that accumulated while the file was being opened.
          for (const chunk of pending[levelKey]) s.write(chunk);
          pending[levelKey] = [];
          return s;
        });
    }
    return init[levelKey];
  }

  /**
   * Write `output` to the named stream level.
   * Guard: only starts a new getStream() call when no init is already in flight.
   * If init is in progress the pending array is sufficient — the then() will drain it.
   */
  function writeTo(levelKey, output) {
    if (streams[levelKey]) {
      streams[levelKey].write(output);
    } else {
      pending[levelKey].push(output);
      if (!init[levelKey]) {
        getStream(levelKey).catch(() => undefined);
      }
    }
  }

  /**
   * Cumulative routing — each file receives its level AND all levels above it.
   *
   *  debug.log  ← everything  (level >= debug)
   *  info.log   ← info+       (level >= info,  includes warn / error / fatal)
   *  error.log  ← error+      (level >= error, includes fatal)
   */
  function route(level, output) {
    if (level >= LOG_LEVELS.debug) writeTo('debug', output);
    if (level >= LOG_LEVELS.info)  writeTo('info',  output);
    if (level >= LOG_LEVELS.error) writeTo('error', output);
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

      route(obj.level, line + '\n');
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
