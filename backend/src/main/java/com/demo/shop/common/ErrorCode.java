package com.demo.shop.common;

import lombok.AllArgsConstructor;
import lombok.Getter;
import org.springframework.http.HttpStatus;

/** 业务错误码：测试脚本断言时直接用 code，不依赖文案 */
@Getter
@AllArgsConstructor
public enum ErrorCode {

    SUCCESS(0, "success"),
    BAD_REQUEST(40000, "请求参数错误"),
    UNAUTHORIZED(40100, "未登录或登录已过期"),
    FORBIDDEN(40300, "无权限访问"),
    NOT_FOUND(40400, "资源不存在"),
    USER_EXISTS(40901, "用户名已存在"),
    INVALID_CREDENTIALS(40101, "用户名或密码错误"),
    PRODUCT_NOT_FOUND(40401, "商品不存在"),
    PRODUCT_OFF_SALE(40902, "商品已下架"),
    STOCK_NOT_ENOUGH(40903, "库存不足"),
    ORDER_NOT_FOUND(40402, "订单不存在"),
    ORDER_STATUS_INVALID(40904, "订单状态不允许该操作"),
    CART_EMPTY(40905, "购物车为空"),
    PAYMENT_NOT_FOUND(40403, "支付单不存在"),
    PAYMENT_STATUS_INVALID(40906, "支付单状态不允许该操作"),
    BALANCE_NOT_ENOUGH(40907, "余额不足"),
    CONFLICT(40900, "并发冲突，请重试"),
    INTERNAL_ERROR(50000, "服务内部错误");

    private final int code;
    private final String message;

    public HttpStatus httpStatus() {
        if (code == UNAUTHORIZED.code || code == INVALID_CREDENTIALS.code) return HttpStatus.UNAUTHORIZED;
        if (code == FORBIDDEN.code) return HttpStatus.FORBIDDEN;
        if (code >= 40400 && code < 40500) return HttpStatus.NOT_FOUND;
        if (code >= 40900 && code < 41000) return HttpStatus.CONFLICT;
        if (code >= 40000 && code < 50000) return HttpStatus.BAD_REQUEST;
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
}
