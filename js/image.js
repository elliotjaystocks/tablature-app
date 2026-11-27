// Prepare a photo for transcription: fix its orientation, scale it down and re-encode it as JPEG.
// Phone photos are often 4,000px+ and several megabytes; around 2,000px on the long edge keeps
// handwriting legible to Claude while keeping uploads quick and well under the 5 MB limit.

const MAX_EDGE = 2000;
const QUALITY = 0.85;

export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file isn’t an image. Please choose a photo or scan of your tab.');
  }

  let bitmap;
  try {
    // `imageOrientation: 'from-image'` honours the EXIF rotation that phones add.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      'Your browser can’t open this image format. If it’s an iPhone HEIC photo, try exporting it as JPEG first.'
    );
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  // White background in case of transparent PNGs.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
  return { base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl };
}
