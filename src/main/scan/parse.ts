import { pinyin } from 'pinyin-pro'
import { fixMojibake } from './encoding'
import { normText } from './text'

export const GP_EXT = new Set(['.gp3', '.gp4', '.gp5', '.gpx', '.gp', '.gtp'])

/** 容器目录，不是艺术家名，也不能当分类。 */
const CONTAINER = [
  /^谱[子集]\d*$/i,
  /^music_gtp$/i,
  /^\d+-/, // 1-初学者… 2-欧美…
  /^(赠送|绝密|打包|合集)/,
  /^guitar/i,
]

interface StyleRule {
  test: RegExp
  label: string
}

/** 顺序有意义：先匹配更具体的。 */
const STYLE_RULES: StyleRule[] = [
  { test: /1-初学者|初学者|基本功|exercises?/i, label: '练习' },
  { test: /2-欧美流行/i, label: '欧美流行' },
  { test: /3-国内流行/i, label: '国内流行' },
  { test: /4-精典.*指弹|押尾桑/i, label: '指弹' },
  { test: /5-【?精品吉他收藏谱】?/i, label: '收藏谱' },
  { test: /\bACG\b|二次元|动漫/i, label: 'ACG' },
  { test: /奔奔老师|教材|课件/i, label: '教材' },
  { test: /摇滚史密斯|rocksmith/i, label: '摇滚史密斯' },
  { test: /^pop_rock$/i, label: '流行摇滚' },
  { test: /^hard_heavy$/i, label: '硬摇滚重金属' },
  { test: /^punk_grunge$/i, label: '朋克垃圾摇滚' },
  { test: /^compositions$/i, label: '原创曲' },
  { test: /^extreme$/i, label: '极端技术' },
  { test: /^neo_metal_indus$/i, label: '新金属工业' },
  { test: /^banjo$/i, label: '班卓' },
  { test: /^fusion_alternative$/i, label: '融合另类' },
  { test: /^classic$/i, label: '古典' },
  { test: /^tv_movie_games$/i, label: '影视游戏' },
  { test: /^world_music$/i, label: '世界音乐' },
  { test: /^blues_jazz$/i, label: '布鲁斯爵士' },
  { test: /^country_folk$/i, label: '乡村民谣' },
  { test: /^competitions$/i, label: '比赛曲' },
  { test: /^picking$/i, label: '指弹' },
  { test: /^progressive$/i, label: '前卫' },
  { test: /^traditionnal$/i, label: '传统' },
  { test: /^flamenco$/i, label: '弗拉门戈' },
  { test: /^bossa_salsa$/i, label: '波萨萨尔萨' },
  { test: /^christian$/i, label: '福音' },
  { test: /^reggae$/i, label: '雷鬼' },
  { test: /^rap_hip_hop$/i, label: '说唱' },
  { test: /^soul_funk$/i, label: '灵魂放克' },
  { test: /^musical_comedy$/i, label: '音乐剧' },
  { test: /^other$/i, label: '其他' }
]

const VERSION_PATTERNS: { test: RegExp; tag: string }[] = [
  { test: /\blive\b|现场/i, tag: '现场' },
  { test: /\bacoustic\b|不插电/i, tag: '不插电' },
  { test: /\bunplugged\b/i, tag: '不插电' },
  { test: /\bdemo\b/i, tag: '样带' },
  { test: /\bremix\b|混音/i, tag: '混音' },
  { test: /\bcover\b|翻弹/i, tag: '翻弹' },
  { test: /\binstrumental\b|伴奏|纯音乐/i, tag: '伴奏' },
  { test: /\bsolo\b|独奏/i, tag: '独奏' },
  { test: /\btab\b/i, tag: 'tab' },
  { test: /教学|教程|讲解/i, tag: '教学' },
  { test: /简化|简单版/i, tag: '简化' },
  { test: /弹唱/i, tag: '弹唱' },
  { test: /指弹/i, tag: '指弹' },
  { test: /尾奏/i, tag: '尾奏' },
  { test: /前奏/i, tag: '前奏' },
  { test: /修正|改版|修订/i, tag: '修正' }
]

const DIFFICULTY: { test: RegExp; label: string }[] = [
  { test: /初学者|初级|入门|beginner|easy|lesson|练习/i, label: '入门' },
  { test: /中高级|高级|advanced|hard|virtuoso|shred/i, label: '进阶' },
  { test: /中级|intermediate/i, label: '中等' }
]

export interface ParsedSong {
  title: string
  artist: string
  album: string
  titleNorm: string
  artistNorm: string
  pinyinInit: string
  category: string
  styleTags: string[]
  versionTags: string[]
  difficulty: string
}

/** 去掉变音符号、统一大小写、抹平标点。洗法见 text.ts。 */
export function normalize(s: string): string {
  return normText(s)
}

/** 归一化时去掉版本后缀，让 `(2)` `- live` 这些不拆散同一首歌。 */
export function normForKey(s: string): string {
  return normalize(
    s
      .replace(/\((?:[^)]*)\)|\[[^\]]*\]/g, ' ')
      .replace(/\s*-\s*(live|acoustic|demo|remix|cover|instrumental|solo)\b.*$/i, '')
      .replace(/教学版|简化版|弹唱版|独奏版|现场版/g, ' ')
  )
}

export function extractVersionTags(stem: string): string[] {
  const tags = new Set<string>()
  const parens = stem.match(/\((\d+)\)|\[(\d+)\]/)
  if (parens) tags.add(`版本 ${parens[1] ?? parens[2]}`)
  for (const p of VERSION_PATTERNS) if (p.test.test(stem)) tags.add(p.tag)
  return [...tags]
}

export function detectDifficulty(pathText: string): string {
  for (const d of DIFFICULTY) if (d.test.test(pathText)) return d.label
  return ''
}

export function detectCategory(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  for (const seg of segs) {
    for (const rule of STYLE_RULES) {
      if (rule.test.test(seg)) return rule.label
    }
  }
  return '未分类'
}

function isContainer(name: string): boolean {
  return CONTAINER.some((r) => r.test(name))
}

/** 中文取拼音首字母，英文取词首，混着连成一串。 */
export function pinyinInitials(s: string): string {
  if (!s) return ''
  const parts: string[] = []
  const cjk = s.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    const arr = pinyin(run, { pattern: 'first', toneType: 'none', type: 'array' })
    parts.push(arr.join(''))
  }
  const latin = s.replace(/[\u4e00-\u9fff]/g, ' ')
  for (const word of latin.split(/[^A-Za-z0-9]+/)) {
    if (word) parts.push(word[0].toLowerCase())
  }
  return parts.join('').slice(0, 48)
}

const ARTIST_SPLIT = /\s+[-–—]\s+/

export function parseFilename(relPath: string, filename: string): ParsedSong {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  const rawStem = filename.slice(0, filename.length - ext.length)
  const stem = fixMojibake(rawStem)

  const segs = relPath.split(/[\\/]/)
  const parent = segs.length > 1 ? fixMojibake(segs[segs.length - 2]) : ''
  const grandParent = segs.length > 2 ? fixMojibake(segs[segs.length - 3]) : ''
  const pathText = [parent, grandParent].join(' / ')

  let artist = ''
  let title = stem
  const m = stem.match(ARTIST_SPLIT)
  if (m && m.index !== undefined) {
    const a = stem.slice(0, m.index).trim()
    const t = stem.slice(m.index + m[0].length).trim()
    if (a && t) {
      artist = a
      title = t
    }
  }

  // 没有 "Artist - Title" 时，往上找一个不是容器目录的父目录当艺术家。
  if (!artist) {
    if (parent && !isContainer(parent) && !/^\d+$/.test(parent)) {
      artist = parent
    } else if (grandParent && !isContainer(grandParent)) {
      artist = grandParent
    }
  }

  // "3 Doors Down - 3 Doors Down - Loser" 这种重复前缀，砍掉一次。
  if (artist) {
    const dup = new RegExp(`^${artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—]\\s*`, 'i')
    if (dup.test(title)) title = title.replace(dup, '').trim()
  }

  title = title.replace(/\s+/g, ' ').trim()
  const album = parent && !isContainer(parent) ? parent : ''

  const category = detectCategory(relPath)
  const difficulty = detectDifficulty(pathText + ' ' + stem)

  return {
    title,
    artist,
    album,
    titleNorm: normForKey(title),
    artistNorm: normForKey(artist),
    pinyinInit: pinyinInitials(title + ' ' + artist),
    category,
    styleTags: [],
    versionTags: extractVersionTags(stem),
    difficulty
  }
}
