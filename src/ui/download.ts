import type { Download } from '../shell/result'

export function saveDownload(file: Download) {
  const link = document.createElement('a')
  let url = file.href ?? ''
  let temporary = false
  if (!url) {
    url = URL.createObjectURL(new Blob([file.text ?? ''], { type: file.mime || 'text/plain' }))
    temporary = true
  }
  link.href = url
  link.download = file.filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  if (temporary) window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}
