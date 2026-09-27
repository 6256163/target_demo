package com.demo.shop.common.enums;

/** 订单生命周期：CREATED -> PAYING -> PAID -> SHIPPED -> DELIVERED，异常分支 CANCELLED / PAY_FAILED */
public enum OrderStatus {
    PENDING_PAYMENT,
    PAYING,
    PAID,
    SHIPPED,
    DELIVERED,
    CANCELLED,
    PAY_FAILED
}
