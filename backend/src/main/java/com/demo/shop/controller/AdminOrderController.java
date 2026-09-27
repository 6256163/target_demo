package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.dto.response.OrderResponse;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.service.OrderService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/orders")
@RequiredArgsConstructor
public class AdminOrderController {

    private final OrderService orderService;

    @GetMapping
    public ApiResponse<PageResponse<OrderResponse>> list(
            @RequestParam(required = false) OrderStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(orderService.adminList(status, page, size));
    }

    @PostMapping("/{orderNo}/ship")
    public ApiResponse<OrderResponse> ship(@PathVariable String orderNo) {
        orderService.markShipped(orderNo);
        return ApiResponse.ok(orderService.get(orderNo));
    }

    @PostMapping("/{orderNo}/deliver")
    public ApiResponse<OrderResponse> deliver(@PathVariable String orderNo) {
        orderService.markDelivered(orderNo);
        return ApiResponse.ok(orderService.get(orderNo));
    }

    @GetMapping("/stats")
    public ApiResponse<Map<String, Object>> stats() {
        return ApiResponse.ok(orderService.stats());
    }
}
