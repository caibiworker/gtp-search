import fs from 'fs'
import path from 'path'
import type Database from 'better-sqlite3'
import type { OrganizePlan, OrganizePlanItem, OrganizeResult } from '@shared/types'

/**
 * 整理只做复制，不动源文件。
 * 先生成计划（dry-run），用户确认后照着计划搬。
 * 每一步写 db 日志 + 目标目录里一份纯文本清单，能反推回原位置。
 */

const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

function safeName(s: string): string {
  const cleaned = s.replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  return cleaned || '未命名'
}

function longPath(p: string): string {
  if (process.platform !== 'win32') return p
  return p.startsWith('\\\\?\\') ? p : '\\\\?\\' + p
}

export function buildPlan(
  db: Database.Database,
  target: string,
  mode: 'all' | 'category'
): OrganizePlan {
  const rows = db
    .prepare(
      `SELECT id, abs_path, artist, title, ext, size, category, title_norm, artist_norm
       FROM songs WHERE missing = 0
       ORDER BY artist_norm, title_norm, id`
    )
    .all() as {
    id: number
    abs_path: string
    artist: string
    title: string
    ext: string
    size: number
    category: string
    title_norm: string
    artist_norm: string
  }[]

  const items: OrganizePlanItem[] = []
  const seen = new Set<string>()
  let skipped = 0
  let conflicts = 0
  let totalBytes = 0

  for (const r of rows) {
    const artist = r.artist ? safeName(r.artist) : '未署名'
    const title = safeName(r.title || path.basename(r.abs_path, r.ext))
    const dir =
      mode === 'category'
        ? path.join(target, safeName(r.category || '未分类'), artist)
        : path.join(target, artist)
    const dst = path.join(dir, `${artist} - ${title}${r.ext}`)
    const key = dst.toLowerCase()
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    const conflict = fs.existsSync(longPath(dst))
    if (conflict) conflicts += 1
    totalBytes += r.size
    items.push({
      src: r.abs_path,
      dst,
      artist: r.artist,
      title: r.title,
      reason: conflict ? '目标已存在' : '同名合并后留一份',
      conflict
    })
  }

  return { target, items, skipped, conflicts, totalBytes }
}

export async function runPlan(
  db: Database.Database,
  target: string,
  items: OrganizePlanItem[]
): Promise<OrganizeResult> {
  const stamp = new Date()
  const ts = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate()
  ).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(
    stamp.getMinutes()
  ).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`
  const logPath = path.join(target, `整理清单-${ts}.txt`)

  await fs.promises.mkdir(longPath(target), { recursive: true })
  const lines: string[] = [
    `# 整理清单 ${stamp.toLocaleString('zh-CN')}`,
    `# 目标 ${target}`,
    `# 共 ${items.length} 项，源文件保持不动`,
    ''
  ]

  let copied = 0
  let failed = 0
  const errors: { src: string; message: string }[] = []
  const insertLog = db.prepare(
    `INSERT INTO organize_logs (created_at, action, src, dst, status, message)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  for (const it of items) {
    try {
      await fs.promises.mkdir(longPath(path.dirname(it.dst)), { recursive: true })
      if (!fs.existsSync(longPath(it.dst))) {
        await fs.promises.copyFile(longPath(it.src), longPath(it.dst))
        copied += 1
        lines.push(`复制  ${it.src}`)
        lines.push(`  ->  ${it.dst}`)
        insertLog.run(Date.now(), 'copy', it.src, it.dst, 'ok', '')
      } else {
        lines.push(`跳过  ${it.src}  目标已存在`)
        insertLog.run(Date.now(), 'copy', it.src, it.dst, 'skip', '目标已存在')
      }
    } catch (e) {
      failed += 1
      const msg = e instanceof Error ? e.message : String(e)
      errors.push({ src: it.src, message: msg })
      lines.push(`失败  ${it.src}  ${msg}`)
      insertLog.run(Date.now(), 'copy', it.src, it.dst, 'fail', msg)
    }
  }

  lines.push('', `# 复制 ${copied}，失败 ${failed}`)
  await fs.promises.writeFile(logPath, lines.join('\r\n'), 'utf8')
  return { copied, failed, logPath, errors }
}

export function readLogs(db: Database.Database, limit = 200): unknown[] {
  return db
    .prepare('SELECT * FROM organize_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown[]
}
