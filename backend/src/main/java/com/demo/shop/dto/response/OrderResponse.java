package com.demo.shop.dto.response;

import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.entity.Order;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public record OrderResponse(
        Long id,
        String orderNo,
        OrderStatus status,
        BigDecimal totalAmount,
        BigDecimal payAmount,
        Integer totalQuantity,
        String receiverName,
        String receiverPhone,
        String receiverAddress,
        String remark,
        List<OrderItemResponse> items,
        LocalDateTime createdAt,
        LocalDateTime updatedAt
) {
    public static OrderResponse from(Order o) {
        return new OrderResponse(
                o.getId(), o.getOrderNo(), o.getStatus(), o.getTotalAmount(), o.getPayAmount(),
                o.getTotalQuantity(), o.getReceiverName(), o.getReceiverPhone(), o.getReceiverAddress(),
                o.getRemark(),
                o.getItems().stream().map(OrderItemResponse::from).toList(),
                o.getCreatedAt(), o.getUpdatedAt());
    }
}
