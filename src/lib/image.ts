/**
 * Shrinks a photo in the browser before upload (faster, cheaper, plenty for food recognition).
 * Returns raw base64 JPEG (no data: prefix). The image is never stored anywhere.
 */
export async function fileToJpegBase64(file: File, maxSide = 1024, quality = 0.82): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG photo.");
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL('image/jpeg', quality);
  return url.slice(url.indexOf(',') + 1);
}
