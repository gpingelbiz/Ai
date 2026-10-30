/** Instagram profile tiles are a 3:4 centre crop of either supported source shape. */
export function profileCrop(width, height) {
  if (!(width > 0 && height > 0)) throw new Error("image dimensions must be positive");
  const targetRatio = 3 / 4;
  if (width / height > targetRatio) {
    const w = Math.floor(height * targetRatio);
    return { x: Math.floor((width - w) / 2), y: 0, w, h: height };
  }
  const h = Math.floor(width / targetRatio);
  return { x: 0, y: Math.floor((height - h) / 2), w: width, h };
}
