const Database = require('better-sqlite3')
const path = require('path')
const db = new Database(
  path.join(process.env.APPDATA, 'gtpsearch', 'gtpsearch.db'),
  { readonly: true }
)
const q = (sql, ...args) => db.prepare(sql).all(...args)

const probe = (label, sql, ...args) => {
  const rows = q(sql, ...args)
  console.log('--- ' + label + ' -> ' + rows.length)
  for (const r of rows) console.log('   ', JSON.stringify(r))
}

probe('周杰伦', "SELECT artist,title FROM groups WHERE artist LIKE '%周杰伦%' LIMIT 3")
probe('beyond', "SELECT artist,title FROM groups WHERE artist LIKE '%beyond%' LIMIT 5")
probe('光辉岁月', "SELECT artist,title FROM groups WHERE title LIKE '%光辉%' LIMIT 5")
probe('海阔天空', "SELECT artist,title FROM groups WHERE title LIKE '%海阔%' LIMIT 5")
probe('aim', "SELECT artist,title FROM groups WHERE artist LIKE '%aim%' LIMIT 6")
probe('beatles', "SELECT artist,title FROM groups WHERE artist LIKE '%beatles%' LIMIT 6")
probe('guns', "SELECT artist,title FROM groups WHERE artist LIKE '%guns%' LIMIT 6")
probe('温柔', "SELECT artist,title FROM groups WHERE title LIKE '%温柔%' LIMIT 5")
probe('五月天', "SELECT artist,title FROM groups WHERE artist LIKE '%五月天%' LIMIT 5")
probe('mojibake 样本', "SELECT artist,title,filename FROM songs WHERE filename GLOB '*[魊鉺醘]*' LIMIT 5")

console.log('\n总数', q('SELECT COUNT(*) c FROM groups')[0].c)
db.close()
