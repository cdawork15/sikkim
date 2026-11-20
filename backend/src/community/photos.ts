import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { localMediaStorage } from '../media/storage.js';
import { invalid } from './model.js';

// Reuse the media decoder to validate and strip metadata from uploaded photos.
export async function preparePhotos(images: string[]) {
  const result: { id: string; content?: Buffer }[] = [];
  for (const image of images) {
    const reference =
      /^\/v1\/community\/photos\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/.exec(
        image,
      );
    if (reference) {
      result.push({ id: reference[1]! });
      continue;
    }
    if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      throw invalid('Choose a valid JPG photo.');
    }
    const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
    const root = await mkdtemp(join(tmpdir(), 'sikkim-community-'));
    const storage = localMediaStorage(root);
    const id = randomUUID();
    try {
      await storage.receive(id, Readable.from(bytes), bytes.length);
      await storage.process(id, 'image/jpeg', '');
      const content = await readFile(join(root, id, 'image.webp'));
      if (content.length > 500000) throw invalid('Choose a smaller photo.');
      result.push({ id, content });
    } catch {
      throw invalid('This photo could not be read. Choose another JPG photo.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  return result;
}
