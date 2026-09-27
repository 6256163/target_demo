package com.demo.shop.dto.response;

import com.demo.shop.entity.OrderItem;

import java.math.BigDecimal;

public record OrderItemResponse(
        Long id,
        Long productId,
        String productName,
        BigDecimal price,
        Integer quantity,
        BigDecimal subtotal
) {
    public static OrderItemResponse from(OrderItem i) {
        return new OrderItemResponse(i.getId(), i.getProductId(), i.getProductName(), i.getPrice(),
                i.getQuantity(), i.getPrice().multiply(BigDecimal.valueOf(i.getQuantity())));
    }
}
