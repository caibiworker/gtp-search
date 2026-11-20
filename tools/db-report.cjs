// 直接在索引库上跑几条体检 SQL。
// 用法：electron tools/db-report.cjs
const { app } = require('electron')
const path = require('path')
const os = require('os')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const file = path.join(os.homedir(), 'AppData', 'Roaming', 'gtpsearch', 'gtpsearch.db')
    const db = new Database(file, { readonly: true })
    const q = (sql) => db.prepare(sql).all()
    console.log('### 分类')
    console.log(q(`SELECT category AS c, COUNT(*) AS n FROM songs GROUP BY 1 ORDER BY n DESC`))
    console.log('### 前 20 首')
    console.log(q(`SELECT stock_no, title, artist, category, repr_id FROM groups ORDER BY stock_no LIMIT 20`))
    console.log('### 空乐手')
    console.log(q(`SELECT COUNT(*) AS n FROM songs WHERE artist = ''`))
    console.log('### 带问号/替换符的标题')
    console.log(q(`SELECT COUNT(*) AS n FROM songs WHERE title LIKE '%?%' OR title LIKE '%�%'`))
    console.log('### 版本数分布')
    console.log(q(`SELECT version_count AS vc, COUNT(*) AS n FROM groups GROUP BY 1 ORDER BY 1 LIMIT 12`))
    db.close()
    app.exit(0)
  } catch (e) {
    console.error('FAIL ' + (e && e.message))
    app.exit(1)
  }
})
