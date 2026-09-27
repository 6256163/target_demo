#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 JMeter 看板补上「应用 / 事务」两个筛选变量，并把过滤条件注入每个面板的 Flux。

为什么需要：Backend Listener 会把每次压测的 application 标签写进 InfluxDB，
不按它过滤的话，多次压测的曲线会叠在同一张图上，看板没法用。

用法：
    python3 monitoring/grafana/dashboards/upgrade_dashboard.py
（原地修改同目录下的 jmeter-dashboard.json，幂等：已注入过不会重复注入）
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "jmeter-dashboard.json")
DS = {"type": "influxdb", "uid": "JMeter-InfluxDB"}


def tag_values_query(tag: str) -> str:
    return ('import "influxdata/influxdb/schema"\n'
            f'schema.tagValues(bucket: "jmeter", tag: "{tag}")')


def var(name: str, label: str, tag: str) -> dict:
    return {
        "type": "query",
        "name": name,
        "label": label,
        "datasource": DS,
        "query": tag_values_query(tag),
        "refresh": 2,          # On time range change
        "includeAll": True,
        "allValue": ".*",
        "multi": False,
        "sort": 1,             # Alphabetical asc
        "current": {"text": ["All"], "value": "$__all"},
        "options": [],
    }


def inject(q: str) -> str:
    """在 _measurement 过滤之后插入 application / transaction 过滤。"""
    if 'r["application"]' in q:
        return q
    lines = q.split("\n")
    out = []
    for ln in lines:
        out.append(ln)
        if '_measurement"] == "jmeter"' in ln:
            out.append('  |> filter(fn: (r) => r["application"] =~ /^${application}$/)')
            out.append('  |> filter(fn: (r) => r["transaction"] =~ /^${transaction}$/)')
    return "\n".join(out)


def main() -> None:
    with open(PATH, encoding="utf-8") as f:
        d = json.load(f)

    # TPS 面板：先把 count 按 1s 求和，再在展示窗口上取均值 —— 结果就是「每秒事务数」，
    # 不受 Backend Listener 上报间隔影响。
    for p in d["panels"]:
        if p.get("title") == "TPS（每秒事务数）":
            for t in p.get("targets", []):
                t["query"] = ('from(bucket: "jmeter")\n'
                              '  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)\n'
                              '  |> filter(fn: (r) => r["_measurement"] == "jmeter")\n'
                              '  |> filter(fn: (r) => r["_field"] == "count")\n'
                              '  |> aggregateWindow(every: 1s, fn: sum, createEmpty: false)\n'
                              '  |> aggregateWindow(every: v.windowPeriod, fn: mean, createEmpty: false)\n'
                              '  |> yield(name: "tps")')
        for t in p.get("targets", []):
            t["query"] = inject(t.get("query", ""))

    if not any(v.get("name") == "application" for v in d.get("templating", {}).get("list", [])):
        d.setdefault("templating", {}).setdefault("list", []).extend([
            var("application", "应用", "application"),
            var("transaction", "事务", "transaction"),
        ])

    d["version"] = d.get("version", 1) + 1
    with open(PATH, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"已更新 {PATH}")
    print("变量:", [v["name"] for v in d["templating"]["list"]])


if __name__ == "__main__":
    main()
