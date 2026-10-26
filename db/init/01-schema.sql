-- ============================================================
-- target_demo 初始化脚本
-- 必须显式声明客户端字符集：MySQL 官方镜像的 mysql 客户端默认 latin1，
-- 不声明会导致 UTF-8 中文被双重编码（表现为接口返回乱码）
SET NAMES utf8mb4;
-- 注意：JPA ddl-auto=none，表结构由此脚本维护，重建环境可重复执行
-- ============================================================
DROP TABLE IF EXISTS `payments`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `cart_items`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `payment_config`;

CREATE TABLE `users`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY,
    `username`    VARCHAR(64)  NOT NULL,
    `password`    VARCHAR(128) NOT NULL,
    `email`       VARCHAR(128),
    `phone`       VARCHAR(32),
    `nickname`    VARCHAR(128),
    `role`        VARCHAR(16)  NOT NULL DEFAULT 'USER',
    `balance`     DECIMAL(12, 2) NOT NULL DEFAULT 10000.00,
    `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
    `created_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY `uk_users_username` (`username`),
    KEY `idx_users_role` (`role`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `categories`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name`        VARCHAR(64)  NOT NULL,
    `description` VARCHAR(255),
    `sort_order`  INT          NOT NULL DEFAULT 0,
    `created_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `products`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name`        VARCHAR(128) NOT NULL,
    `description` VARCHAR(512),
    `price`       DECIMAL(12, 2) NOT NULL,
    `stock`       INT          NOT NULL DEFAULT 0,
    `image_url`   VARCHAR(255),
    `category_id` BIGINT,
    `status`      VARCHAR(16)  NOT NULL DEFAULT 'ON_SALE',
    `version`     BIGINT       NOT NULL DEFAULT 0,
    `created_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    KEY `idx_products_category` (`category_id`),
    KEY `idx_products_status` (`status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `cart_items`
(
    `id`             BIGINT AUTO_INCREMENT PRIMARY KEY,
    `user_id`        BIGINT NOT NULL,
    `product_id`     BIGINT NOT NULL,
    `quantity`       INT    NOT NULL DEFAULT 1,
    `snapshot_price` DECIMAL(12, 2) NOT NULL,
    `created_at`     DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`     DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY `uk_cart_user_product` (`user_id`, `product_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `orders`
(
    `id`               BIGINT AUTO_INCREMENT PRIMARY KEY,
    `order_no`         VARCHAR(32)  NOT NULL,
    `user_id`          BIGINT       NOT NULL,
    `status`           VARCHAR(20)  NOT NULL,
    `total_amount`     DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `pay_amount`       DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `total_quantity`   INT          NOT NULL DEFAULT 0,
    `receiver_name`    VARCHAR(255),
    `receiver_phone`   VARCHAR(32),
    `receiver_address` VARCHAR(512),
    `remark`           VARCHAR(255),
    `created_at`       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY `uk_orders_no` (`order_no`),
    KEY `idx_orders_user` (`user_id`),
    KEY `idx_orders_status` (`status`),
    KEY `idx_orders_created` (`created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `order_items`
(
    `id`          BIGINT AUTO_INCREMENT PRIMARY KEY,
    `order_id`    BIGINT NOT NULL,
    `product_id`  BIGINT NOT NULL,
    `product_name` VARCHAR(128) NOT NULL,
    `price`       DECIMAL(12, 2) NOT NULL,
    `quantity`    INT    NOT NULL,
    `created_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    KEY `idx_order_items_order` (`order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `payments`
(
    `id`                BIGINT AUTO_INCREMENT PRIMARY KEY,
    `trade_no`          VARCHAR(40) NOT NULL,
    `order_no`          VARCHAR(32) NOT NULL,
    `user_id`           BIGINT      NOT NULL,
    `pay_type`          VARCHAR(20) NOT NULL DEFAULT 'ALIPAY',
    `status`            VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
    `amount`            DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `gateway_code`      VARCHAR(32),
    `gateway_message`   VARCHAR(255),
    `callback_id`       VARCHAR(64),
    `requested_outcome` VARCHAR(16),
    `created_at`        DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`        DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY `uk_payments_trade_no` (`trade_no`),
    KEY `idx_payments_order` (`order_no`),
    KEY `idx_payments_status` (`status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE `payment_config`
(
    `id`            BIGINT AUTO_INCREMENT PRIMARY KEY,
    `name`          VARCHAR(32) NOT NULL,
    `failure_rate`  DOUBLE      NOT NULL DEFAULT 0.05,
    `timeout_rate`  DOUBLE      NOT NULL DEFAULT 0.03,
    `min_delay_ms`  INT         NOT NULL DEFAULT 300,
    `max_delay_ms`  INT         NOT NULL DEFAULT 2000,
    `async_enabled` TINYINT(1)  NOT NULL DEFAULT 1,
    `created_at`    DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at`    DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
