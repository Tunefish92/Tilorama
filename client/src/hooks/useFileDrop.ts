import { useEffect, useState } from 'react'
import { openFile } from '../app/actions'

const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false

/**
 * Accepts files dropped anywhere on the window and images pasted from the clipboard.
 * Returns whether a file is currently being dragged over the window.
 */
export function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    // dragenter/dragleave fire for every child element; a counter tells when the pointer really left.
    let depth = 0

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (++depth === 1) setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      if (--depth <= 0) {
        depth = 0
        setDragging(false)
      }
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const file = event.dataTransfer?.files[0]
      if (file) void openFile(file)
    }
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea')) return
      const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (file) {
        event.preventDefault()
        void openFile(new File([file], file.name || 'pasted-image.png', { type: file.type }))
      }
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [])

  return dragging
}
