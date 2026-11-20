import type Database from 'better-sqlite3'
import type {
  CategoryCount,
  SearchQuery,
  SearchResult,
  SongFile,
  SongGroup,
  Stats
} from '@shared/types'

export interface SongRow {
  rootId: number
  relPath: string
  absPath: string
  filename: string
  ext: string
  size: number
  mtime: number
  title: string
  artist: string
  album: string
  titleNorm: string
  artistNorm: string
  pinyinInit: string
  searchBlob: string
  category: string
  styleTags: string[]
  versionTags: string[]
  difficulty: string
  metaSource: string
}

export function upsertSongs(db: Database.Database, rows: SongRow[]): void {
  const stmt = db.prepare(`
    INSERT INTO songs (
      root_id, rel_path, abs_path, filename, ext, size, mtime,
      title, artist, album, title_norm, artist_norm, pinyin_init, search_blob,
      category, style_tags, version_tags, difficulty, meta_source,
      created_at, missing
    ) VALUES (
      @rootId, @relPath, @absPath, @filename, @ext, @size, @mtime,
      @title, @artist, @album, @titleNorm, @artistNorm, @pinyinInit, @searchBlob,
      @category, @styleTags, @versionTags, @difficulty, @metaSource,
      @createdAt, 0
    )
    ON CONFLICT(root_id, rel_path) DO UPDATE SET
      abs_path = excluded.abs_path,
      filename = excluded.filename,
      size = excluded.size,
      mtime = excluded.mtime,
      missing = 0,
      title = CASE WHEN songs.meta_confirmed = 1 THEN songs.title ELSE excluded.title END,
      artist = CASE WHEN songs.meta_confirmed = 1 THEN songs.artist ELSE excluded.artist END,
      album = excluded.album,
      title_norm = CASE WHEN songs.meta_confirmed = 1 THEN songs.title_norm ELSE excluded.title_norm END,
      artist_norm = CASE WHEN songs.meta_confirmed = 1 THEN songs.artist_norm ELSE excluded.artist_norm END,
      pinyin_init = CASE WHEN songs.meta_confirmed = 1 THEN songs.pinyin_init ELSE excluded.pinyin_init END,
      search_blob = CASE WHEN songs.meta_confirmed = 1 THEN songs.search_blob ELSE excluded.search_blob END,
      category = excluded.category,
      version_tags = excluded.version_tags,
      difficulty = excluded.difficulty
  `)
  const now = Date.now()
  for (const r of rows) {
    stmt.run({
      rootId: r.rootId,
      relPath: r.relPath,
      absPath: r.absPath,
      filename: r.filename,
      ext: r.ext,
      size: r.size,
      mtime: r.mtime,
      title: r.title,
      artist: r.artist,
      album: r.album,
      titleNorm: r.titleNorm,
      artistNorm: r.artistNorm,
      pinyinInit: r.pinyinInit,
      searchBlob: r.searchBlob,
      category: r.category,
      styleTags: r.styleTags.join(','),
      versionTags: r.versionTags.join(','),
      difficulty: r.difficulty,
      metaSource: r.metaSource,
      createdAt: now
    })
  }
}

/** 全量重建聚合表。扫描后调用一次。 */
export function rebuildGroups(db: Database.Database): void {
  const run = db.transaction(() => {
    db.exec('DELETE FROM groups')
    db.exec(`
      INSERT INTO groups (
        key, artist, title, artist_norm, title_norm, pinyin_init, category,
        version_count, total_size, max_mtime, repr_id, repr_ext, repr_path,
        fav, play_count, last_opened_at, missing_count, search_blob, stock_no
      )
      SELECT
        artist_norm || char(1) || title_norm,
        artist, title, artist_norm, title_norm, pinyin_init, category,
        vc, ts, mm, id, ext, rel_path,
        fv, pc, lo, mc, search_blob,
        1000 + ROW_NUMBER() OVER (
          ORDER BY CASE WHEN artist_norm = '' THEN 1 ELSE 0 END, artist_norm, title_norm, id
        )
      FROM (
        SELECT
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY artist_norm, title_norm
            ORDER BY
              CASE ext
                WHEN '.gpx' THEN 0
                WHEN '.gp5' THEN 1
                WHEN '.gp' THEN 2
                WHEN '.gp4' THEN 3
                WHEN '.gtp' THEN 4
                ELSE 5
              END,
              size DESC, id ASC
          ) AS rn,
          COUNT(*) OVER (PARTITION BY artist_norm, title_norm) AS vc,
          SUM(size) OVER (PARTITION BY artist_norm, title_norm) AS ts,
          MAX(mtime) OVER (PARTITION BY artist_norm, title_norm) AS mm,
          MAX(fav) OVER (PARTITION BY artist_norm, title_norm) AS fv,
          SUM(play_count) OVER (PARTITION BY artist_norm, title_norm) AS pc,
          MAX(last_opened_at) OVER (PARTITION BY artist_norm, title_norm) AS lo,
          SUM(missing) OVER (PARTITION BY artist_norm, title_norm) AS mc
        FROM songs AS s
      ) AS agg
      WHERE rn = 1
    `)
  })
  run()
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

const ORDER: Record<SearchQuery['sort'], string> = {
  title: "CASE WHEN title_norm = '' THEN 1 ELSE 0 END, title_norm ASC, artist_norm ASC",
  artist: "CASE WHEN artist_norm = '' THEN 1 ELSE 0 END, artist_norm ASC, title_norm ASC",
  recent: 'COALESCE(last_opened_at, 0) DESC, title_norm ASC',
  size: 'total_size DESC, title_norm ASC',
  stock: 'stock_no ASC'
}

interface WhereParts {
  sql: string
  params: unknown[]
}

function buildWhere(q: SearchQuery): WhereParts {
  const where: string[] = []
  const params: unknown[] = []

  if (q.mode === 'fav') {
    where.push('fav = 1')
  } else if (q.mode === 'recent') {
    where.push('last_opened_at IS NOT NULL')
  } else if (q.mode === 'missing') {
    where.push('missing_count > 0')
  }
  if (q.mode === 'category' && q.category) {
    where.push('category = ?')
    params.push(q.category)
  }

  const text = q.text.trim()
  if (text) {
    const like = `%${escapeLike(text.toLowerCase())}%`
    where.push(
      "(title_norm LIKE ? ESCAPE '\\' OR artist_norm LIKE ? ESCAPE '\\' OR pinyin_init LIKE ? ESCAPE '\\' OR repr_path LIKE ? ESCAPE '\\')"
    )
    params.push(like, like, like, like)
  }

  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

export function searchGroups(db: Database.Database, q: SearchQuery): SearchResult {
  const t0 = performance.now()
  const { sql, params } = buildWhere(q)
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM groups ${sql}`).get(...params) as { n: number }
  ).n

  const order = ORDER[q.sort] ?? ORDER.title
  const rows = db
    .prepare(
      `SELECT key, stock_no, artist, title, artist_norm, title_norm, pinyin_init, category,
              version_count, total_size, max_mtime, repr_id, repr_ext, fav, play_count,
              last_opened_at, missing_count
       FROM groups ${sql}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    )
    .all(...params, q.limit, q.offset) as Record<string, unknown>[]

  const mapped: SongGroup[] = rows.map((r) => ({
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
  }))

  return { total, rows: mapped, elapsedMs: Math.round((performance.now() - t0) * 10) / 10 }
}

export function stats(db: Database.Database): Stats {
  const files = (db.prepare('SELECT COUNT(*) AS n FROM songs').get() as { n: number }).n
  const groups = (db.prepare('SELECT COUNT(*) AS n FROM groups').get() as { n: number }).n
  const missing = (
    db.prepare('SELECT COUNT(*) AS n FROM songs WHERE missing = 1').get() as { n: number }
  ).n
  const favs = (db.prepare('SELECT COUNT(*) AS n FROM groups WHERE fav = 1').get() as {
    n: number
  }).n
  const dup = db
    .prepare(
      `SELECT COUNT(*) AS groups, COALESCE(SUM(version_count), 0) AS files
       FROM groups WHERE version_count > 1`
    )
    .get() as { groups: number; files: number }

  const categories = db
    .prepare(
      `SELECT category AS name, COUNT(*) AS count FROM groups
       GROUP BY category ORDER BY count DESC`
    )
    .all() as CategoryCount[]

  const recent = (db.prepare('SELECT COUNT(*) AS n FROM groups WHERE last_opened_at IS NOT NULL').get() as { n: number }).n

  const last = db.prepare('SELECT MAX(last_scan_at) AS t FROM roots').get() as { t: number | null }

  return {
    files,
    groups,
    dupGroups: dup.groups,
    dupFiles: Math.max(0, dup.files - dup.groups),
    missing,
    favs,
    recent,
    categories,
    lastScanAt: last.t ?? null
  }
}

export function versionsOf(
  db: Database.Database,
  artistNorm: string,
  titleNorm: string
): SongFile[] {
  const rows = db
    .prepare(
      `SELECT * FROM songs WHERE artist_norm = ? AND title_norm = ?
       ORDER BY CASE ext
         WHEN '.gpx' THEN 0 WHEN '.gp5' THEN 1 WHEN '.gp' THEN 2
         WHEN '.gp4' THEN 3 WHEN '.gtp' THEN 4 ELSE 5 END, size DESC`
    )
    .all(artistNorm, titleNorm) as Record<string, unknown>[]

  return rows.map((r) => ({
    id: r.id as number,
    rootId: r.root_id as number,
    relPath: r.rel_path as string,
    absPath: r.abs_path as string,
    filename: r.filename as string,
    ext: r.ext as string,
    size: r.size as number,
    mtime: r.mtime as number,
    title: r.title as string,
    artist: r.artist as string,
    album: r.album as string,
    titleNorm: r.title_norm as string,
    artistNorm: r.artist_norm as string,
    pinyinInit: r.pinyin_init as string,
    category: r.category as string,
    styleTags: String(r.style_tags ?? '').split(',').filter(Boolean),
    versionTags: String(r.version_tags ?? '').split(',').filter(Boolean),
    difficulty: r.difficulty as string,
    metaSource: r.meta_source as string,
    metaConfirmed: (r.meta_confirmed as number) === 1,
    hash: (r.hash as string | null) ?? null,
    fav: (r.fav as number) === 1,
    playCount: r.play_count as number,
    lastOpenedAt: (r.last_opened_at as number | null) ?? null,
    createdAt: r.created_at as number,
    missing: (r.missing as number) === 1
  }))
}

export function songById(db: Database.Database, id: number): SongFile | null {
  const r = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!r) return null
  return {
    id: r.id as number,
    rootId: r.root_id as number,
    relPath: r.rel_path as string,
    absPath: r.abs_path as string,
    filename: r.filename as string,
    ext: r.ext as string,
    size: r.size as number,
    mtime: r.mtime as number,
    title: r.title as string,
    artist: r.artist as string,
    album: r.album as string,
    titleNorm: r.title_norm as string,
    artistNorm: r.artist_norm as string,
    pinyinInit: r.pinyin_init as string,
    category: r.category as string,
    styleTags: String(r.style_tags ?? '').split(',').filter(Boolean),
    versionTags: String(r.version_tags ?? '').split(',').filter(Boolean),
    difficulty: r.difficulty as string,
    metaSource: r.meta_source as string,
    metaConfirmed: (r.meta_confirmed as number) === 1,
    hash: (r.hash as string | null) ?? null,
    fav: (r.fav as number) === 1,
    playCount: r.play_count as number,
    lastOpenedAt: (r.last_opened_at as number | null) ?? null,
    createdAt: r.created_at as number,
    missing: (r.missing as number) === 1
  }
}

/** 收藏/取消收藏按“歌”走，整组一起变。 */
export function toggleFav(db: Database.Database, artistNorm: string, titleNorm: string): boolean {
  const row = db
    .prepare('SELECT fav FROM groups WHERE artist_norm = ? AND title_norm = ?')
    .get(artistNorm, titleNorm) as { fav: number } | undefined
  const next = row && row.fav === 1 ? 0 : 1
  const run = db.transaction(() => {
    db.prepare('UPDATE songs SET fav = ? WHERE artist_norm = ? AND title_norm = ?').run(
      next,
      artistNorm,
      titleNorm
    )
    db.prepare('UPDATE groups SET fav = ? WHERE artist_norm = ? AND title_norm = ?').run(
      next,
      artistNorm,
      titleNorm
    )
  })
  run()
  return next === 1
}

export function markOpened(db: Database.Database, id: number, artistNorm: string, titleNorm: string): void {
  const now = Date.now()
  const run = db.transaction(() => {
    db.prepare(
      'UPDATE songs SET play_count = play_count + 1, last_opened_at = ? WHERE id = ?'
    ).run(now, id)
    db.prepare(
      `UPDATE groups SET play_count = play_count + 1, last_opened_at = ?
       WHERE artist_norm = ? AND title_norm = ?`
    ).run(now, artistNorm, titleNorm)
  })
  run()
}

export function renameSong(
  db: Database.Database,
  id: number,
  title: string,
  artist: string,
  titleNorm: string,
  artistNorm: string,
  pinyinInit: string,
  searchBlob: string
): void {
  const prev = db.prepare('SELECT artist_norm, title_norm FROM songs WHERE id = ?').get(id) as
    | { artist_norm: string; title_norm: string }
    | undefined
  if (!prev) return
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE songs SET title = ?, artist = ?, title_norm = ?, artist_norm = ?,
        pinyin_init = ?, search_blob = ?, meta_confirmed = 1, meta_source = 'manual'
       WHERE id = ?`
    ).run(title, artist, titleNorm, artistNorm, pinyinInit, searchBlob, id)
  })
  run()
}

export function getSetting(db: Database.Database, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return r?.value ?? null
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value)
}

export function listCategories(db: Database.Database): CategoryCount[] {
  return db
    .prepare(
      'SELECT category AS name, COUNT(*) AS count FROM groups GROUP BY category ORDER BY count DESC'
    )
    .all() as CategoryCount[]
}

