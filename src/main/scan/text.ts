import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import { fixMojibake } from './encoding'

/**
 * 入库时把标题/乐手洗成一种写法，查询时不用再算。
 * 洗的顺序有讲究：编码修复要在转码之前，去 the 要在去标点之后。
 */
const toSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' })

const CJK = /[\u4e00-\u9fff]+/g

/** 全角 → 半角。中文标点（，。《》）不在此列，后一步统一抹成空格。 */
function halfWidth(s: string): string {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
}

export function normText(input: string): string {
  if (!input) return ''
  let s = fixMojibake(input)
  s = halfWidth(s)
  s = toSimplified(s)
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  s = s.toLowerCase()
  s = s.replace(/&/g, ' and ')
  // "Beatles (The)" 这种写法在这个库里很常见，先把尾巴上的 the 摘掉
  s = s.replace(/\(\s*the\s*\)/gi, ' ')
  s = s.replace(/,\s*the\b/gi, ' ')
  s = s.replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^(the|a|an)\s+/, '')
  s = s.replace(/\s+(feat|ft|featuring)\b.*$/, '')
  return s.trim()
}

/** 中文全拼连写：周杰伦 → zhoulun。非汉字部分不管，norm 里已经有了。 */
export function pinyinFull(s: string): string {
  const runs = s.match(CJK)
  if (!runs) return ''
  return runs
    .map((r) => pinyin(r, { toneType: 'none', type: 'array' }).join(''))
    .join(' ')
}

/** 中文首字母：周杰伦 → zjl。 */
export function pinyinFirst(s: string): string {
  const runs = s.match(CJK)
  if (!runs) return ''
  return runs
    .map((r) => pinyin(r, { pattern: 'first', toneType: 'none', type: 'array' }).join(''))
    .join(' ')
}

/**
 * 一行一条，小写，空格分隔。
 * 标题、乐手、两种拼音，全塞进去，查询时一次 includes 就够。
 */
export function buildBlob(title: string, artist: string): string {
  const parts = [
    normText(title),
    normText(artist),
    pinyinFull(title),
    pinyinFirst(title),
    pinyinFull(artist),
    pinyinFirst(artist)
  ]
  return parts.filter(Boolean).join(' ')
}
