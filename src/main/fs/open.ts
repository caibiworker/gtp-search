import { shell } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const GP_FALLBACKS = [
  'C:\\Program Files\\Arobas Music\\Guitar Pro 8\\GuitarPro.exe',
  'C:\\Program Files (x86)\\Arobas Music\\Guitar Pro 8\\GuitarPro.exe',
  'C:\\Program Files\\Arobas Music\\Guitar Pro 7\\GuitarPro7.exe'
]

export function detectGuitarPro(): string {
  for (const p of GP_FALLBACKS) {
    if (fs.existsSync(p)) return p
  }
  return ''
}

/** 系统调用（ShellExecute、资源管理器）不认 \\?\ 前缀，交出去之前先摘掉。 */
function nativePath(p: string): string {
  if (p.startsWith('\\\\?\\UNC\\')) return '\\\\' + p.slice(8)
  if (p.startsWith('\\\\?\\')) return p.slice(4)
  return p
}

/**
 * 打开谱子。
 *
 * 这里必须走 ShellExecute（shell.openPath），不能直接 spawn Guitar Pro。
 * Guitar Pro 8 是单实例的：自己已经在跑的时候，只有一个从资源管理器双击
 * 传进来的 shell 请求会被主实例接走；直接 spawn 出来的第二个进程命令行
 * 会被它丢掉，结果就是"GP 被拉起来了，但谱子没开"。
 */
export async function openSong(
  absPath: string,
  gpPath: string
): Promise<{ ok: boolean; message: string }> {
  if (!fs.existsSync(absPath)) {
    return { ok: false, message: '文件不在了。可能被挪走或者删了。' }
  }
  const target = nativePath(absPath)

  const shellErr = await shell.openPath(target)
  if (!shellErr) return { ok: true, message: '' }

  // 系统关联坏了才自己拉。用 start 而不是直接跑 exe，
  // 这样仍然是 shell 语义，单实例转发能接住。
  const gp = gpPath && fs.existsSync(gpPath) ? gpPath : detectGuitarPro()
  if (gp) {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', gp, target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: path.dirname(target)
      })
      child.unref()
      return { ok: true, message: '' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, message: `Guitar Pro 起不来：${msg}` }
    }
  }

  return { ok: false, message: `打不开。${shellErr}` }
}

export function revealSong(absPath: string): void {
  shell.showItemInFolder(nativePath(absPath))
}
