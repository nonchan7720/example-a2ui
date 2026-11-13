/** Blob をファイルとして保存させる。 */
export function download(blob: Blob, fileName: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName.replace(/[\\/:*?"<>|]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
