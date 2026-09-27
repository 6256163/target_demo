-- ============================================================
-- 压测/自动化测试用种子数据
SET NAMES utf8mb4;
-- 账号密码统一为明文 + {noop} 前缀（Spring Security DelegatingPasswordEncoder 支持）
-- ============================================================
INSERT INTO `payment_config` (`name`, `failure_rate`, `timeout_rate`, `min_delay_ms`, `max_delay_ms`, `async_enabled`)
VALUES ('default', 0.05, 0.03, 300, 2000, 1);

INSERT INTO `categories` (`name`, `description`, `sort_order`) VALUES
    ('手机数码', '手机、平板、智能穿戴', 1),
    ('家用电器', '大家电与小家电', 2),
    ('图书文娱', '图书、影视、文具', 3),
    ('生鲜食品', '水果、零食、饮料', 4);

DELIMITER $$
DROP PROCEDURE IF EXISTS seed_users$$
CREATE PROCEDURE seed_users(IN total INT)
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE nm VARCHAR(64);
    WHILE i <= total DO
        SET nm = CONCAT('user', LPAD(i, 5, '0'));
        INSERT INTO `users` (`username`, `password`, `email`, `nickname`, `role`, `balance`)
        VALUES (nm, '{noop}123456', CONCAT(nm, '@shop.demo'), CONCAT('压测用户', i), 'USER', 10000.00);
        SET i = i + 1;
    END WHILE;
END$$
DELIMITER ;

CALL seed_users(1000);
DROP PROCEDURE seed_users;

DELIMITER $$
DROP PROCEDURE IF EXISTS seed_products$$
CREATE PROCEDURE seed_products(IN total INT)
BEGIN
    DECLARE i INT DEFAULT 1;
    DECLARE nominal VARCHAR(128);
    WHILE i <= total DO
        SET nominal = CONCAT('商品-', LPAD(i, 4, '0'), '-',
                             ELT(1 + (i MOD 6), '标准版', '旗舰版', '青春版', '限量版', '礼盒装', '促销装'));
        INSERT INTO `products` (`name`, `description`, `price`, `stock`, `image_url`, `category_id`, `status`)
        VALUES (nominal,
                CONCAT('压测专用商品描述 #', i),
                ROUND(9.90 + (i MOD 200) * 12.5, 2),
                10000,
                CONCAT('https://cdn.shop.demo/img/', i, '.png'),
                1 + (i MOD 4),
                CASE WHEN i MOD 20 = 0 THEN 'OFF_SALE' ELSE 'ON_SALE' END);
        SET i = i + 1;
    END WHILE;
END$$
DELIMITER ;

CALL seed_products(200);
DROP PROCEDURE seed_products;

-- 管理员与演示账号
INSERT INTO `users` (`username`, `password`, `email`, `nickname`, `role`, `balance`)
VALUES ('admin', '{noop}admin123', 'admin@shop.demo', '超级管理员', 'ADMIN', 999999.00),
       ('tester', '{noop}123456', 'tester@shop.demo', '固定演示账号', 'USER', 50000.00);

-- 热点商品：压测时集中访问，便于观察缓存命中/击穿
UPDATE `products` SET `stock` = 100000 WHERE `id` BETWEEN 1 AND 10;

SELECT COUNT(*) AS user_count FROM `users`;
SELECT COUNT(*) AS product_count FROM `products`;
