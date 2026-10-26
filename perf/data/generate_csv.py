#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
target_demo JMeter 参数化数据生成器。

设计要点（决定了压测结果是否可信）：
1. 固定区间 + 加权抽样，不是全范围随机。商品 id 从「有界池」里按 热:温:冷 ≈ 10:3:1
   抽取，全范围随机会把缓存命中率打到 0、把 DB 打穿，量出来的容量是假的。
2. 排除下架商品。种子数据里 id % 20 == 0 的商品是 OFF_SALE，下单/加购会返回 40902，
   混进参数池会污染错误率。
3. 多个 CSV 在同一个线程组里使用时，每次迭代各前进一行 —— 所以同一批文件的
   行数必须一致（--rows 统一控制），否则用户 A 会配上商品 B 的数据。
4. 强制 LF 换行。Python csv 默认 CRLF，末尾列会被 \r 污染（中文关键字列首当其冲）。
5. 数量列用偏态分布（多数 1-2 件，少量大额），让金额/库存相关分支有真实覆盖。

用法：
    # 性能测试账号池（默认 user00001 起，5000 行）
    python3 generate_csv.py --tag perf
    # 压力测试账号池（与性能池隔离，默认从 user00501 起）
    python3 generate_csv.py --tag stress
    # 自定义规模
    python3 generate_csv.py --tag perf --rows 20000 --user-pool 1000 --product-pool 200
"""
import argparse
import csv
import os
import random

# 与 db/init/02-seed.sql 中商品命名规则保持一致：ELT(1 + (i MOD 6), ...)
SUFFIXES = ["标准版", "旗舰版", "青春版", "限量版", "礼盒装", "促销装"]

# 数量偏态分布：多数 1-2 件，长尾到 10 件
QTY_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10]
QTY_WEIGHTS = [38, 26, 14, 8, 6, 4, 2, 2]


def build_product_pool(product_pool: int, hot_top: int, warm_top: int, off_sale_mod: int):
    """返回 (候选 id 列表, 对应权重列表)。热:温:冷 = 10:3:1。"""
    ids, weights = [], []
    for pid in range(1, product_pool + 1):
        if off_sale_mod and pid % off_sale_mod == 0:
            continue  # 下架商品不入池
        if pid <= hot_top:
            weights.append(10)
        elif pid <= warm_top:
            weights.append(3)
        else:
            weights.append(1)
        ids.append(pid)
    return ids, weights


def main():
    ap = argparse.ArgumentParser(description="生成 JMeter 参数化 CSV")
    ap.add_argument("--tag", default="perf", choices=["perf", "stress"],
                    help="数据池标签，决定输出文件名与账号起始偏移")
    ap.add_argument("--rows", type=int, default=5000, help="每个文件的行数（多个文件必须一致）")
    ap.add_argument("--user-pool", type=int, default=1000, help="可使用的账号总数（<=种子数据 1000）")
    ap.add_argument("--user-offset", type=int, default=None,
                    help="账号起始偏移；perf 默认 0，stress 默认 user-pool 的一半")
    ap.add_argument("--user-count", type=int, default=None,
                    help="实际使用的账号数量，默认=user-pool/2（perf 用前半、stress 用后半做隔离）")
    ap.add_argument("--product-pool", type=int, default=200, help="商品 id 上限")
    ap.add_argument("--hot-top", type=int, default=10, help="热点商品 id 上限（种子数据把 1-10 库存调到 10w）")
    ap.add_argument("--warm-top", type=int, default=40, help="温数据 id 上限")
    ap.add_argument("--off-sale-mod", type=int, default=20,
                    help="id 能被该值整除的商品视为下架并排除（0 表示不排除）")
    ap.add_argument("--seed", type=int, default=20260927, help="随机种子，保证可复现")
    ap.add_argument("--out-dir", default=None, help="输出目录，默认脚本所在目录")
    args = ap.parse_args()

    if args.user_offset is None:
        args.user_offset = 0 if args.tag == "perf" else args.user_pool // 2
    if args.user_count is None:
        args.user_count = args.user_pool // 2
    if args.user_offset + args.user_count > args.user_pool:
        raise SystemExit(f"账号区间越界：offset={args.user_offset} count={args.user_count} pool={args.user_pool}")

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(args.seed)

    # ---------- users ----------
    users_file = "users.csv" if args.tag == "perf" else "users-stress.csv"
    with open(os.path.join(out_dir, users_file), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["username", "password"])
        for i in range(args.rows):
            # 顺序轮转保证每个账号均匀使用；叠加一次随机避免相邻行总是同一批账号
            uid = args.user_offset + ((i * 7 + rng.randint(0, args.user_count - 1)) % args.user_count) + 1
            w.writerow([f"user{uid:05d}", "123456"])

    # ---------- products ----------
    pool_ids, pool_weights = build_product_pool(
        args.product_pool, args.hot_top, args.warm_top, args.off_sale_mod)
    if not pool_ids:
        raise SystemExit("商品池为空，检查 --product-pool / --off-sale-mod")

    products_file = "products.csv" if args.tag == "perf" else "products-stress.csv"
    with open(os.path.join(out_dir, products_file), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["productId", "keyword", "categoryId", "quantity"])
        for _ in range(args.rows):
            pid = rng.choices(pool_ids, weights=pool_weights, k=1)[0]
            keyword = SUFFIXES[pid % 6]      # 与商品名后缀一致，保证 LIKE 能命中
            category_id = (pid % 4) + 1      # 与种子数据 1 + (i MOD 4) 一致
            qty = rng.choices(QTY_CHOICES, weights=QTY_WEIGHTS, k=1)[0]
            w.writerow([pid, keyword, category_id, qty])

    print(f"[{args.tag}] {users_file}: {args.rows} 行  "
          f"账号区间 user{args.user_offset + 1:05d}~user{args.user_offset + args.user_count:05d}")
    print(f"[{args.tag}] {products_file}: {args.rows} 行  "
          f"商品池 {len(pool_ids)} 个（热<= {args.hot_top} / 温<= {args.warm_top} / 冷其余，"
          f"排除 id%{args.off_sale_mod}==0）")
    print(f"[{args.tag}] 输出目录: {out_dir}")
    print(f"[{args.tag}] 行数一致 = {args.rows}（多 CSV 同线程组使用时的行序对齐前提）")


if __name__ == "__main__":
    main()
