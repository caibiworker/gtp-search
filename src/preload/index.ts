import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ScanProgress } from '@shared/types'

const api: Api = {
  scanStart: (mode) => ipcRenderer.invoke('scan:start', mode),
  scanProgress: () => ipcRenderer.invoke('scan:progress'),
  onScanProgress: (cb) => {
    const handler = (_e: unknown, p: ScanProgress): void => cb(p)
    ipcRenderer.on('scan:progress', handler)
    return () => ipcRenderer.removeListener('scan:progress', handler)
  },
  search: (q) => ipcRenderer.invoke('search:query', q),
  stats: () => ipcRenderer.invoke('stats:get'),
  roots: () => ipcRenderer.invoke('roots:list'),
  addRoot: (dir) => ipcRenderer.invoke('roots:add', dir),
  removeRoot: (id) => ipcRenderer.invoke('roots:remove', id),
  versions: (a, t) => ipcRenderer.invoke('song:versions', a, t),
  open: (id) => ipcRenderer.invoke('song:open', id),
  reveal: (id) => ipcRenderer.invoke('song:reveal', id),
  toggleFav: (a, t) => ipcRenderer.invoke('song:fav', a, t),
  renameSong: (id, title, artist) => ipcRenderer.invoke('song:rename', id, title, artist),
  planOrganize: (target, mode) => ipcRenderer.invoke('organize:plan', target, mode),
  runOrganize: (target, items) => ipcRenderer.invoke('organize:run', target, items),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  rebuild: () => ipcRenderer.invoke('scan:rebuild')
}

contextBridge.exposeInMainWorld('api', api)
