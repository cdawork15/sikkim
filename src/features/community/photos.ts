export const MAX_EVENT_PHOTOS = 4;
const MAX_STORED_PHOTO_LENGTH = 200_000;

export function isStoredPhoto(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_STORED_PHOTO_LENGTH &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

export async function prepareEventPhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose JPG, PNG or WebP photos.');
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error('Each photo must be 10 MB or smaller.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('This photo could not be opened. Try another image.');
    }
    if (image.naturalWidth * image.naturalHeight > 32_000_000)
      throw new Error(
        'This photo is too large. Choose one under 32 megapixels.',
      );
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('Photo processing is unavailable. Try another browser.');
    for (const edge of [1400, 1000, 700]) {
      const scale = Math.min(
        1,
        edge / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL('image/jpeg', 0.78);
      if (isStoredPhoto(photo)) return photo;
    }
    throw new Error(
      'This photo is too detailed to save locally. Try a smaller image.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
