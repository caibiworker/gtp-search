import { promises as fs } from 'fs'
import path from 'path'
import { GP_EXT } from './parse'

const LONGPATH = '\\\\?\\'

/** 相对路径按反斜杠存，跨平台只在 Windows 跑，简单处理。 */
export interface WalkedFile {
  absPath: string
  relPath: string
  size: number
  mtime: number
}

export interface WalkResult {
  files: WalkedFile[]
  errors: number
  dirs: number
}

/**
 * 带 \\?\ 前缀的递归遍历。
 * 两个源库里有 258 字符的路径，加上目标目录就会越过 260，
 * 所以不依赖系统长路径开关。
 */
export async function walkRoot(
  root: string,
  onTick?: (count: number) => void
): Promise<WalkResult> {
  const absRoot = path.resolve(root)
  const files: WalkedFile[] = []
  let errors = 0
  let dirs = 0
  const stack: string[] = [LONGPATH + absRoot]

  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      errors += 1
      continue
    }
    dirs += 1
    for (const entry of entries) {
      const full = dir.endsWith('\\') ? dir + entry.name : dir + '\\' + entry.name
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!GP_EXT.has(ext)) continue
      let st
      try {
        st = await fs.stat(full)
      } catch {
        errors += 1
        continue
      }
      const clean = full.startsWith(LONGPATH) ? full.slice(LONGPATH.length) : full
      files.push({
        absPath: clean,
        relPath: path.relative(absRoot, clean),
        size: st.size,
        mtime: Math.floor(st.mtimeMs)
      })
      if (onTick && files.length % 2000 === 0) onTick(files.length)
    }
  }

  return { files, errors, dirs }
}
