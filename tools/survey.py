# -*- coding: utf-8 -*-
"""现场勘察：路径长度、编码损坏、重复分组。只读。

用法：
    python tools/survey.py "D:\\谱集" "E:\\另一个谱集"
"""
import os, sys, json, re, collections

sys.stdout.reconfigure(encoding="utf-8")

ROOTS = [p for p in sys.argv[1:] if p.strip()]
EXT = {".gp3", ".gp4", ".gp5", ".gpx", ".gp", ".gtp"}
LONG = "\\\\?\\"


def walk_long(root):
    """用 \\\\?\\ 前缀遍历，突破 260 字符限制。"""
    stack = [LONG + os.path.abspath(root)]
    out = []
    errs = 0
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except OSError:
            errs += 1
            continue
        with it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(LONG + e.path if not e.path.startswith(LONG) else e.path)
                    elif e.is_file(follow_symlinks=False):
                        out.append((e.path, e.stat(follow_symlinks=False).st_size))
                except OSError:
                    errs += 1
                    continue
    return out, errs


def demojibake(name):
    try:
        fixed = name.encode("gbk").decode("cp1252")
        return fixed
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None


def main():
    stat = {"roots": [], "by_ext": collections.Counter(), "len_buckets": collections.Counter()}
    names = collections.Counter()
    all_files = []
    total_errs = 0
    for root in ROOTS:
        files, errs = walk_long(root)
        total_errs += errs
        gps = [(p, s) for p, s in files if os.path.splitext(p)[1].lower() in EXT]
        stat["roots"].append({"root": root, "files": len(files), "gp": len(gps), "walk_errors": errs})
        for p, s in gps:
            ext = os.path.splitext(p)[1].lower()
            stat["by_ext"][ext] += 1
            L = len(p)
            b = "<=260" if L <= 260 else ("261-300" if L <= 300 else ">300")
            stat["len_buckets"][b] += 1
            base = os.path.basename(p)
            names[base.lower()] += 1
            all_files.append((p, s, base))

    dup_groups = {k: v for k, v in names.items() if v > 1}
    print(json.dumps({
        "roots": stat["roots"],
        "by_ext": dict(stat["by_ext"]),
        "gp_total": sum(stat["by_ext"].values()),
        "len_buckets": dict(stat["len_buckets"]),
        "walk_errors": total_errs,
        "dup_groups": len(dup_groups),
        "dup_files": sum(dup_groups.values()),
    }, ensure_ascii=False, indent=1))

    broken = []
    for p, s, base in all_files:
        stem = os.path.splitext(base)[0]
        fixed = demojibake(stem)
        if fixed and fixed != stem:
            broken.append((base, fixed))
    print("BROKEN_COUNT", len(broken))
    for a, b in broken[:15]:
        print("  ", a, "->", b)

    all_files.sort(key=lambda x: len(x[0]), reverse=True)
    print("LONGEST")
    for p, s, base in all_files[:5]:
        print("  ", len(p), p)


if __name__ == "__main__":
    main()
