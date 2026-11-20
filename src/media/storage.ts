import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  validateCaptions,
  mediaInvalid,
  variantFiles,
  type ContentType,
  type Variant,
} from './model.js';

const execute = promisify(execFile);
type StreamInfo = {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
};

export function localMediaStorage(root: string) {
  function directory(id: string) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      throw mediaInvalid('Invalid media identifier.');
    }
    return join(root, id);
  }
  const file = (id: string, name: string) => join(directory(id), name);

  return {
    async receive(id: string, input: Readable, expected: number) {
      await mkdir(directory(id), { recursive: true, mode: 0o700 });
      let received = 0;
      const bound = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          received += chunk.length;
          done(
            received > expected
              ? mediaInvalid('The file exceeds its declared size.')
              : null,
            chunk,
          );
        },
      });
      // Keep pipeline errors from destroying the HTTP request before an error
      // response can be sent. Only the bounded file stream belongs to pipeline.
      const failed = (error: Error) => bound.destroy(error);
      const closed = () => {
        if (!input.readableEnded) {
          bound.destroy(mediaInvalid('The upload was interrupted.'));
        }
      };
      input.on('error', failed);
      input.on('close', closed);
      input.pipe(bound);
      try {
        await pipeline(
          bound,
          createWriteStream(file(id, 'source'), {
            flags: 'wx',
            mode: 0o600,
          }),
        );
        if (received !== expected) {
          throw mediaInvalid('The file size does not match the upload.');
        }
      } catch (error) {
        await rm(file(id, 'source'), { force: true });
        throw error;
      } finally {
        input.unpipe(bound);
        input.off('error', failed);
        input.off('close', closed);
        // Discard remaining request bytes without buffering or writing them.
        if (!input.destroyed && !input.readableEnded) {
          input.resume();
        }
      }
    },

    async process(id: string, type: ContentType, captions: string) {
      const source = file(id, 'source');
      const handle = await open(source, 'r');
      const header = Buffer.alloc(16);
      try {
        await handle.read(header, 0, header.length, 0);
      } finally {
        await handle.close();
      }
      const matches: Record<ContentType, boolean> = {
        'image/jpeg': header
          .subarray(0, 3)
          .equals(Buffer.from([255, 216, 255])),
        'image/png': header
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'image/webp':
          header.toString('ascii', 0, 4) === 'RIFF' &&
          header.toString('ascii', 8, 12) === 'WEBP',
        'video/mp4': header.toString('ascii', 4, 8) === 'ftyp',
        'video/webm': header
          .subarray(0, 4)
          .equals(Buffer.from([26, 69, 223, 163])),
      };
      if (!matches[type]) {
        throw mediaInvalid('The file contents do not match the selected type.');
      }
      const { stdout } = await execute(
        'ffprobe',
        [
          '-v',
          'error',
          '-protocol_whitelist',
          'file,pipe',
          '-show_streams',
          '-show_format',
          '-of',
          'json',
          source,
        ],
        { timeout: 10000, maxBuffer: 1024 * 1024 },
      );
      const probe = JSON.parse(stdout) as {
        streams: StreamInfo[];
        format: { duration?: string };
      };
      const video = probe.streams.filter(
        (stream) => stream.codec_type === 'video',
      );
      const image = type.startsWith('image/');
      if (
        video.length !== 1 ||
        probe.streams.length > (image ? 1 : 2) ||
        probe.streams.some(
          (stream) => !['video', 'audio'].includes(stream.codec_type),
        )
      ) {
        throw mediaInvalid('Use a single image or video with optional audio.');
      }
      const { width = 0, height = 0 } = video[0]!;
      if (
        !width ||
        !height ||
        width * height > 16777216 ||
        width > 8192 ||
        height > 8192
      ) {
        throw mediaInvalid('The media dimensions are too large.');
      }
      const duration = Number(probe.format.duration);
      if (
        !image &&
        (!Number.isFinite(duration) || duration <= 0 || duration > 60)
      ) {
        throw mediaInvalid('Videos must be no longer than 60 seconds.');
      }
      const base = [
        '-nostdin',
        '-v',
        'error',
        '-y',
        '-protocol_whitelist',
        'file,pipe',
        '-threads',
        '1',
        '-i',
        source,
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
      ];
      const run = (args: string[]) =>
        execute('ffmpeg', [...base, ...args], {
          timeout: 90000,
          maxBuffer: 1024 * 1024,
        });
      const variants: Partial<Record<Variant, number>> = {};
      if (image) {
        await run([
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          "scale='min(1600,iw)':-2",
          '-c:v',
          'libwebp',
          '-threads',
          '1',
          file(id, variantFiles.image),
        ]);
        variants.image = (await stat(file(id, variantFiles.image))).size;
      } else {
        if (!captions) {
          throw mediaInvalid('Videos need a plain-text caption file.');
        }
        await run([
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-t',
          '60',
          '-vf',
          "scale='min(720,iw)':-2",
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-pix_fmt',
          'yuv420p',
          '-threads',
          '1',
          '-r',
          '24',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
          '-movflags',
          '+faststart',
          file(id, variantFiles.video),
        ]);
        await run([
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          "scale='min(720,iw)':-2",
          '-c:v',
          'libwebp',
          '-threads',
          '1',
          file(id, variantFiles.poster),
        ]);
        await writeFile(
          file(id, variantFiles.captions),
          validateCaptions(captions, duration),
          {
            mode: 0o600,
          },
        );
        for (const variant of ['video', 'poster', 'captions'] as const) {
          variants[variant] = (
            await stat(file(id, variantFiles[variant]))
          ).size;
        }
      }
      return variants;
    },

    read(id: string, variant: Variant, range?: { start: number; end: number }) {
      return createReadStream(file(id, variantFiles[variant]), range);
    },
    async removeSource(id: string) {
      await rm(file(id, 'source'), { force: true });
    },
    async remove(id: string) {
      await rm(directory(id), { recursive: true, force: true });
    },
  };
}
