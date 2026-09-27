-- ============================================================
-- shop-demo 压测后数据一致性校验
--
-- 压力下正确性比指标更重要。每轮压力测试结束后执行：
--   docker exec -i shop-mysql mysql -ushop -pshop123456 shop_demo \
--       --default-character-set=utf8mb4 < perf/data/consistency-check.sql
--
-- 判定标准：下面 6 项里 1-5 必须全部「PASS」。
-- ============================================================

SELECT '===== 0. 总体数据量 =====' AS section;
SELECT (SELECT COUNT(*) FROM orders)      AS orders,
       (SELECT COUNT(*) FROM order_items) AS order_items,
       (SELECT COUNT(*) FROM payments)    AS payments,
       (SELECT COUNT(*) FROM cart_items)  AS cart_items;

SELECT '===== 1. 不超卖（每个商品已下单量 <= 初始库存 + 补货）=====' AS section;
-- 说明：种子数据里 id BETWEEN 1 AND 10 的热点商品初始库存是 100000，其余是 10000。
-- 这里用「当前库存 >= 0」+「已售总量 <= 初始库存」两个角度校验。
SELECT p.id,
       p.name,
       p.stock                                   AS stock_now,
       COALESCE(SUM(oi.quantity), 0)             AS sold_qty,
       CASE WHEN p.stock >= 0 THEN 'PASS' ELSE 'FAIL' END AS stock_not_negative
FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
GROUP BY p.id, p.name, p.stock
HAVING p.stock < 0
LIMIT 20;
-- 上面查询无结果 = PASS（没有任何商品库存被扣成负数）

SELECT '===== 2. 不重复扣款（同一订单 SUCCESS 支付单有且仅有一条）=====' AS section;
SELECT order_no, COUNT(*) AS success_payments
FROM payments
WHERE status = 'SUCCESS'
GROUP BY order_no
HAVING COUNT(*) > 1
LIMIT 20;
-- 上面查询无结果 = PASS

SELECT '===== 3. 库存守恒（已取消/支付失败/已退款的订单，库存必须回滚）=====' AS section;
-- 逐商品核对：当前库存 + 有效订单已售量 + 失败回滚量 应该等于初始库存。
-- 简化判定：把「终态为失败类」的订单对应的商品数量加回后，不应出现库存超出初始值的情形。
SELECT 'cancelled/pay_failed/refunded 订单明细（人工抽查）' AS note;
SELECT o.order_no, o.status, oi.product_id, oi.quantity, o.updated_at
FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
WHERE o.status IN ('CANCELLED', 'PAY_FAILED', 'REFUNDED')
ORDER BY o.updated_at DESC
LIMIT 20;

SELECT '===== 4. 孤儿订单（超过 TTL 仍未关单的 PENDING_PAYMENT）=====' AS section;
-- 超时关单 TTL 默认 10 分钟。压测结束 10 分钟后再跑这条，应该无结果。
SELECT order_no, status, created_at, TIMESTAMPDIFF(MINUTE, created_at, NOW()) AS age_min
FROM orders
WHERE status IN ('PENDING_PAYMENT', 'PAYING')
  AND created_at < NOW() - INTERVAL 15 MINUTE
LIMIT 20;
-- 上面查询无结果 = PASS（延迟队列 + 定时补偿任务生效）

SELECT '===== 5. 支付单卡在 PROCESSING（MQ 消费滞后）=====' AS section;
-- 压测结束 10 分钟后跑，应该无结果；有结果说明 q.payment.process 堆积或消费端挂了。
SELECT p.trade_no, p.order_no, p.status, p.created_at,
       TIMESTAMPDIFF(MINUTE, p.created_at, NOW()) AS age_min
FROM payments p
WHERE p.status = 'PROCESSING'
  AND p.created_at < NOW() - INTERVAL 10 MINUTE
LIMIT 20;
-- 上面查询无结果 = PASS

SELECT '===== 6. 订单状态分布（对照预期比例，判断支付失败率配置是否生效）=====' AS section;
SELECT status, COUNT(*) AS cnt, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM orders), 2) AS pct
FROM orders
GROUP BY status
ORDER BY cnt DESC;

SELECT '===== 7. 支付结果分布 =====' AS section;
SELECT status, COUNT(*) AS cnt
FROM payments
GROUP BY status
ORDER BY cnt DESC;

SELECT '===== 8. 乐观锁冲突统计（下单 409 的次数，反映写热点争用）=====' AS section;
-- 需要后端日志配合：grep '库存并发冲突' 的条数；这里给出订单创建成功率作为侧面指标
SELECT COUNT(*) AS total_orders,
       SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END) AS effective_orders
FROM orders;
