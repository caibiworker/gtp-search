import type Database from 'better-sqlite3'

/**
 * 迁移按版本号顺序执行，启动时补齐。
 * 每次只往前加，不改历史版本。
 */
const MIGRATIONS: { version: number; up: (db: Database.Database) => void }[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS roots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          last_scan_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS songs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          root_id INTEGER NOT NULL,
          rel_path TEXT NOT NULL,
          abs_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          ext TEXT NOT NULL,
          size INTEGER NOT NULL,
          mtime INTEGER NOT NULL,
          title TEXT NOT NULL,
          artist TEXT NOT NULL DEFAULT '',
          album TEXT NOT NULL DEFAULT '',
          title_norm TEXT NOT NULL,
          artist_norm TEXT NOT NULL DEFAULT '',
          pinyin_init TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '',
          style_tags TEXT NOT NULL DEFAULT '',
          version_tags TEXT NOT NULL DEFAULT '',
          difficulty TEXT NOT NULL DEFAULT '',
          meta_source TEXT NOT NULL DEFAULT 'filename',
          meta_confirmed INTEGER NOT NULL DEFAULT 0,
          hash TEXT,
          fav INTEGER NOT NULL DEFAULT 0,
          play_count INTEGER NOT NULL DEFAULT 0,
          last_opened_at INTEGER,
          created_at INTEGER NOT NULL,
          missing INTEGER NOT NULL DEFAULT 0,
          UNIQUE(root_id, rel_path)
        );

        CREATE INDEX IF NOT EXISTS idx_songs_group ON songs(artist_norm, title_norm);
        CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title_norm);
        CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_norm);
        CREATE INDEX IF NOT EXISTS idx_songs_pinyin ON songs(pinyin_init);
        CREATE INDEX IF NOT EXISTS idx_songs_category ON songs(category);
        CREATE INDEX IF NOT EXISTS idx_songs_root ON songs(root_id);

        CREATE TABLE IF NOT EXISTS groups (
          key TEXT PRIMARY KEY,
          artist TEXT NOT NULL,
          title TEXT NOT NULL,
          artist_norm TEXT NOT NULL,
          title_norm TEXT NOT NULL,
          pinyin_init TEXT NOT NULL,
          category TEXT NOT NULL,
          version_count INTEGER NOT NULL,
          total_size INTEGER NOT NULL,
          max_mtime INTEGER NOT NULL,
          repr_id INTEGER NOT NULL,
          repr_ext TEXT NOT NULL,
          repr_path TEXT NOT NULL,
          fav INTEGER NOT NULL,
          play_count INTEGER NOT NULL,
          last_opened_at INTEGER,
          missing_count INTEGER NOT NULL,
          stock_no INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_groups_title ON groups(title_norm);
        CREATE INDEX IF NOT EXISTS idx_groups_artist ON groups(artist_norm);
        CREATE INDEX IF NOT EXISTS idx_groups_pinyin ON groups(pinyin_init);
        CREATE INDEX IF NOT EXISTS idx_groups_category ON groups(category);
        CREATE INDEX IF NOT EXISTS idx_groups_recent ON groups(last_opened_at);
        CREATE INDEX IF NOT EXISTS idx_groups_fav ON groups(fav);

        CREATE TABLE IF NOT EXISTS organize_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          action TEXT NOT NULL,
          src TEXT NOT NULL,
          dst TEXT NOT NULL,
          status TEXT NOT NULL,
          message TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  },
  {
    version: 2,
    up(db) {
      // 入库时就把标题、乐手、全拼、首字母拼成一行，查询只做 includes。
      db.exec(`
        ALTER TABLE songs ADD COLUMN search_blob TEXT NOT NULL DEFAULT '';
        ALTER TABLE groups ADD COLUMN search_blob TEXT NOT NULL DEFAULT '';
      `)
    }
  }
]

export function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
    | { version: number }
    | undefined
  let current = row?.version ?? 0
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    const run = db.transaction(() => {
      m.up(db)
      // 只留一行版本号，别攒成历史流水
      db.prepare('DELETE FROM schema_meta').run()
      db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(m.version)
    })
    run()
    current = m.version
  }
}
