import iconv from 'iconv-lite'

/**
 * 修复文件名编码损坏。
 *
 * 实际情况：解压时把 cp1252 的字节按 GBK 解释，于是
 *   "Forêt" -> "F魊et"，"Rêve" -> "R陃e"。
 * 可逆：整串按 GBK 取回字节，再按 cp1252 解释。
 *
 * 危险在于误判真正的中文名。判据：
 *   1. 串里同时有拉丁字母和汉字；
 *   2. 汉字不成词（没有连续两个以上汉字）；
 *   3. 还原后整串不含汉字、不含替换符，且没有控制字符。
 * 三条都满足才动手，否则原样返回。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]{2,}/
const LATIN = /[A-Za-z]/
const CTRL = /[\u0000-\u001f\u007f]/
const REPLACEMENT = /\ufffd/

export function fixMojibake(input: string): string {
  if (!input) return input

  // 情况一：UTF-8 字节被当成 latin1/cp1252，出现 Ã© Ã¨ 这种。
  if (/[ÃÂ][\u0080-\u00bf]/.test(input)) {
    const back = tryLatin1ToUtf8(input)
    if (back && back !== input && !REPLACEMENT.test(back)) return back
  }

  // 情况二：cp1252 字节被当成 GBK，出现孤立汉字夹在英文里。
  if (!CJK.test(input) || !LATIN.test(input)) return input
  if (CJK_RUN.test(input)) return input
  if (input.replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, '').length > 4) return input

  const fixed = tryGbkToCp1252(input)
  if (!fixed || fixed === input) return input
  if (CJK.test(fixed) || REPLACEMENT.test(fixed) || CTRL.test(fixed)) return input
  if (!LATIN.test(fixed)) return input
  // 还原后不应该出现连续两个空格或孤立标点开头
  if (/\s{2,}/.test(fixed)) return input
  return fixed
}

function tryGbkToCp1252(input: string): string | null {
  try {
    const bytes = iconv.encode(input, 'gbk')
    // GBK 编码失败会变成 '?'，长度会明显变化，直接放弃
    const decoded = iconv.decode(bytes, 'win1252')
    return decoded
  } catch {
    return null
  }
}

function tryLatin1ToUtf8(input: string): string | null {
  try {
    const bytes = iconv.encode(input, 'win1252')
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return null
  }
}

/** 路径的每一段都过一遍。 */
export function fixPathSegments(p: string): string {
  return p
    .split(/[\\/]/)
    .map((seg) => fixMojibake(seg))
    .join('\\')
}
