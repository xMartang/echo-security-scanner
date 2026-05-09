/**
 * Pino worker-thread transport.
 * Demuxes NDJSON lines by numeric pino level into three rotating log files:
 *   - ${serviceName}.debug.{n}.log  (level 20)
 *   - ${serviceName}.info.{n}.log   (level 30 + 40 warn, folded)
 *   - ${serviceName}.error.{n}.log  (level >= 50)
 *
 * Streams are lazily created on first write for each level so no empty
 * files are left behind for levels that receive no records.
 *
 * pino-roll appends a sequence number to the base path; e.g.:
 *   api.debug.1.log, api.debug.2.log, … (daily + 50 MB rotation, 7 files)
 */

import roll from 'pino-roll';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';

export default async function transport(opts) {
  const { dir = './logs/local', serviceName = 'app' } = opts;

  await mkdir(dir, { recursive: true });

  const rollOpts = {
    frequency: 'daily',
    size: '50m',
    extension: '.log',
    limit: { count: 7 },
    mkdir: true,
  };

  // Lazy stream cache: created only when a record of that level first arrives.
  const streams = { debug: null, info: null, error: null };
  // Pending writes accumulated while the stream is being initialised.
  const pending = { debug: [], info: [], error: [] };
  // Initialisation promises — prevent duplicate creation on concurrent writes.
  const init = { debug: null, info: null, error: null };

  async function getStream(level) {
    if (streams[level]) return streams[level];
    if (!init[level]) {
      init[level] = roll({ file: join(dir, `${serviceName}.${level}`), ...rollOpts }).then((s) => {
        streams[level] = s;
        // Drain buffered writes that arrived during initialisation
        for (const chunk of pending[level]) s.write(chunk);
        pending[level] = [];
        return s;
      });
    }
    return init[level];
  }

  function route(level, output) {
    if (level === 20) {
      if (streams.debug) streams.debug.write(output);
      else { pending.debug.push(output); getStream('debug').catch(() => undefined); }
    } else if (level === 30 || level === 40) {
      if (streams.info) streams.info.write(output);
      else { pending.info.push(output); getStream('info').catch(() => undefined); }
    } else if (level >= 50) {
      if (streams.error) streams.error.write(output);
      else { pending.error.push(output); getStream('error').catch(() => undefined); }
    }
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
      let pending2 = active.length;
      function done() { if (--pending2 === 0) callback(); }
      active.forEach((s) => s.end(done));
    },
  });
}
