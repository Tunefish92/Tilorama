const BROWSER_DECODABLE = /^image\/(jpeg|png|webp|gif|avif|bmp)$/
const MAX_PREVIEW_SOURCE_BYTES = 80 * 1024 * 1024

/**
 * Creates a tiny preview of a local file for the blurred backdrop shown while uploading and tiling.
 * Returns null when the browser can't decode the format (e.g. TIFF) or the file is too big to decode cheaply.
 */
export async function createPreviewUrl(file: File): Promise<string | null> {
  if (!BROWSER_DECODABLE.test(file.type) || file.size > MAX_PREVIEW_SOURCE_BYTES) return null
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 320, resizeQuality: 'low' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.7))
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

export function revokePreviewUrl(url: string | null | undefined) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}
