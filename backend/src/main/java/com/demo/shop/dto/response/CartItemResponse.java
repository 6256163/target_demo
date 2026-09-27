package com.demo.shop.dto.response;

import java.math.BigDecimal;

public record CartItemResponse(
        Long id,
        Long productId,
        String productName,
        BigDecimal snapshotPrice,
        Integer quantity,
        BigDecimal subtotal,
        Integer availableStock
) {
}
