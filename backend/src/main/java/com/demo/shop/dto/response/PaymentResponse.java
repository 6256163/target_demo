package com.demo.shop.dto.response;

import com.demo.shop.common.enums.PayType;
import com.demo.shop.common.enums.PaymentStatus;
import com.demo.shop.entity.Payment;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record PaymentResponse(
        String tradeNo,
        String orderNo,
        PayType payType,
        PaymentStatus status,
        BigDecimal amount,
        String gatewayCode,
        String gatewayMessage,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static PaymentResponse from(Payment p) {
        return new PaymentResponse(p.getTradeNo(), p.getOrderNo(), p.getPayType(), p.getStatus(),
                p.getAmount(), p.getGatewayCode(), p.getGatewayMessage(), p.getCreatedAt(), p.getUpdatedAt());
    }
}
