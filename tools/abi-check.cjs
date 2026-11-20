// 验证 better-sqlite3 是否按 Electron 的 ABI 编译。
// 用法：node_modules\electron\dist\electron.exe tools\abi-check.cjs
const { app } = require('electron')

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    const row = db.prepare('select sqlite_version() as v').get()
    db.close()
    console.log('ABI_OK sqlite=' + row.v + ' electron=' + process.versions.electron + ' modules=' + process.versions.modules)
    app.exit(0)
  } catch (e) {
    console.error('ABI_FAIL ' + (e && e.message))
    app.exit(1)
  }
})
