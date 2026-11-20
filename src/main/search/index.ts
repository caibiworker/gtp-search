import type Database from 'better-sqlite3'
import type { SearchQuery, SearchResult, SongGroup } from '@shared/types'
import { normText, pinyinFull } from '../scan/text'

/**
 * 查询不碰数据库。
 * 启动时把 4 万多条摊进内存，一次线性扫，几毫秒。
 * 数据库只在拿到 repr_id 之后取整行。
 */
interface Entry {
  id: number // repr_id，组里代表版本的 songs.id
  blob: string
  tn: string
  an: string
  py: string // 全拼，只在"一个都没命中"时拿来做残缺匹配
  fav: number
  opened: number
  stock: number
  size: number
  cat: string
  missing: number
}

const LIMIT = 500

const SCAN_SQL = `
  SELECT repr_id AS id, search_blob AS blob, title_norm AS tn, artist_norm AS an,
         fav, COALESCE(last_opened_at, 0) AS opened, stock_no AS stock,
         total_size AS size, category AS cat, missing_count AS missing
  FROM groups
`

export interface BuildInfo {
  count: number
  ms: number
  bytes: number
}

export class SearchIndex {
  private rows: Entry[] = []
  private builtAt = 0

  get size(): number {
    return this.rows.length
  }

  get age(): number {
    return this.builtAt
  }

  build(db: Database.Database): BuildInfo {
    const t0 = performance.now()
    const raw = db.prepare(SCAN_SQL).all() as Omit<Entry, 'py'>[]
    let bytes = 0
    this.rows = raw.map((r) => {
      // 拼音只在残缺匹配的时候用得上，算一次存着
      const py = pinyinFull(r.an) + ' ' + pinyinFull(r.tn)
      bytes += 96 + r.blob.length * 2 + r.tn.length * 2 + r.an.length * 2 + r.cat.length * 2
      return { ...r, py }
    })
    this.builtAt = Date.now()
    for (const r of this.rows) bytes += r.py.length * 2
    return { count: raw.length, ms: Math.round(performance.now() - t0), bytes }
  }

  /** 包一层：db 刚变过，索引过期了就重建。 */
  ensure(db: Database.Database): void {
    if (this.rows.length === 0) this.build(db)
  }

  /** 收藏、打开之后只刷这两列，不动整张索引。 */
  reloadFlags(db: Database.Database): void {
    if (this.rows.length === 0) return
    const rows = db
      .prepare(
        `SELECT repr_id AS id, fav, COALESCE(last_opened_at, 0) AS opened FROM groups`
      )
      .all() as { id: number; fav: number; opened: number }[]
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const e of this.rows) {
      const u = byId.get(e.id)
      if (u) {
        e.fav = u.fav
        e.opened = u.opened
      }
    }
  }

  private pass(e: Entry, q: SearchQuery): boolean {
    if (q.mode === 'fav' && e.fav !== 1) return false
    if (q.mode === 'recent' && e.opened === 0) return false
    if (q.mode === 'missing' && e.missing === 0) return false
    if (q.mode === 'category' && q.category && e.cat !== q.category) return false
    return true
  }

  query(q: SearchQuery): { ids: number[]; total: number; ms: number; tokens: string[] } {
    const t0 = performance.now()
    const tokens = normText(q.text).split(' ').filter(Boolean)

    if (tokens.length === 0) {
      const pool = this.rows.filter((e) => this.pass(e, q))
      this.sortPlain(pool, q.sort)
      return {
        ids: pool.slice(0, LIMIT).map((e) => e.id),
        total: pool.length,
        ms: performance.now() - t0,
        tokens
      }
    }

    const scored: { e: Entry; s: number }[] = []
    for (const e of this.rows) {
      if (!this.pass(e, q)) continue
      let sum = 0
      let allHit = true
      for (const tok of tokens) {
        const s = scoreOne(e, tok)
        if (s === 0) {
          allHit = false
          break
        }
        sum += s
      }
      if (allHit) scored.push({ e, s: sum })
    }

    // 一个都没命中，而且输入像拼音（纯字母、够长），再试一次残缺匹配。
    // zhoulun 这种少打了音节的写法能捞回来，代价是一次全表子序列扫描。
    if (scored.length === 0 && tokens.every((t) => /^[a-z]{4,}$/.test(t))) {
      for (const e of this.rows) {
        if (!this.pass(e, q)) continue
        let ok = true
        for (const tok of tokens) {
          if (!subsequence(e.py, tok)) {
            ok = false
            break
          }
        }
        if (ok) scored.push({ e, s: 8 * tokens.length })
      }
    }

    scored.sort((a, b) => b.s - a.s || b.e.fav - a.e.fav || b.e.opened - a.e.opened || cmp(a.e.tn, b.e.tn) || a.e.id - b.e.id)

    return {
      ids: scored.slice(0, LIMIT).map((x) => x.e.id),
      total: scored.length,
      ms: performance.now() - t0,
      tokens
    }
  }

  private sortPlain(pool: Entry[], sort: SearchQuery['sort']): void {
    if (sort === 'artist') {
      pool.sort(
        (a, b) =>
          (a.an === '' ? 1 : 0) - (b.an === '' ? 1 : 0) || cmp(a.an, b.an) || cmp(a.tn, b.tn)
      )
    } else if (sort === 'size') {
      pool.sort((a, b) => b.size - a.size || cmp(a.tn, b.tn))
    } else if (sort === 'stock') {
      pool.sort((a, b) => a.stock - b.stock)
    } else if (sort === 'title') {
      pool.sort(
        (a, b) =>
          (a.tn === '' ? 1 : 0) - (b.tn === '' ? 1 : 0) || cmp(a.tn, b.tn) || cmp(a.an, b.an)
      )
    } else {
      pool.sort((a, b) => b.opened - a.opened || cmp(a.tn, b.tn) || cmp(a.an, b.an))
    }
  }
}

/** localeCompare 在四万条上太贵，直接按码位比，够用且稳定。 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * tok 是不是 s 的子序列。只用来兜错拼：z-h-o-u-l-u-n 能穿过 zhoujielun。
 * 限制总跳跃距离，避免 "be" 这种短词在长串里乱穿。
 */
function subsequence(s: string, tok: string): boolean {
  let i = 0
  let gap = 0
  let lastHit = -1
  for (let j = 0; j < tok.length; j++) {
    const at = s.indexOf(tok[j], i)
    if (at < 0) return false
    if (lastHit >= 0) gap += at - lastHit - 1
    if (gap > 6) return false
    lastHit = at
    i = at + 1
  }
  return true
}

/** 一段词在这条记录上能拿到的最高分。0 表示没命中。 */
function scoreOne(e: Entry, tok: string): number {
  let s = 0
  if (e.tn === tok) s = 100
  else if (e.tn.startsWith(tok)) s = 80
  else if (e.tn.includes(tok)) s = 60

  if (e.an === tok) s = Math.max(s, 70)
  else if (e.an.startsWith(tok)) s = Math.max(s, 55)
  else if (e.an.includes(tok)) s = Math.max(s, 40)

  if (s === 0 && e.blob.includes(tok)) s = 20
  return s
}

/** 按 id 顺序取整行。groups 的主键是 key，用 repr_id 对应。 */
export function fetchGroups(db: Database.Database, ids: number[]): SongGroup[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT key, stock_no, artist, title, artist_norm, title_norm, pinyin_init, category,
              version_count, total_size, max_mtime, repr_id, repr_ext, fav, play_count,
              last_opened_at, missing_count
       FROM groups WHERE repr_id IN (${placeholders})`
    )
    .all(...ids) as Record<string, unknown>[]

  const byId = new Map<number, SongGroup>()
  for (const r of rows) {
    const g: SongGroup = {
      key: r.key as string,
      stockNo: r.stock_no as number,
      artist: r.artist as string,
      title: r.title as string,
      artistNorm: r.artist_norm as string,
      titleNorm: r.title_norm as string,
      pinyinInit: r.pinyin_init as string,
      category: r.category as string,
      versionCount: r.version_count as number,
      totalSize: r.total_size as number,
      maxMtime: r.max_mtime as number,
      reprId: r.repr_id as number,
      reprExt: r.repr_ext as string,
      fav: (r.fav as number) === 1,
      playCount: r.play_count as number,
      lastOpenedAt: (r.last_opened_at as number | null) ?? null,
      missingCount: r.missing_count as number
    }
    byId.set(g.reprId, g)
  }
  const out: SongGroup[] = []
  for (const id of ids) {
    const g = byId.get(id)
    if (g) out.push(g)
  }
  return out
}

export const searchIndex = new SearchIndex()

export function searchAll(db: Database.Database, q: SearchQuery): SearchResult {
  searchIndex.ensure(db)
  const t0 = performance.now()
  const res = searchIndex.query(q)
  const rows = fetchGroups(db, res.ids)
  return {
    total: res.total,
    rows,
    elapsedMs: Math.round((performance.now() - t0) * 10) / 10
  }
}
