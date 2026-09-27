package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.config.security.CurrentUser;
import com.demo.shop.dto.request.CreateOrderRequest;
import com.demo.shop.dto.response.OrderResponse;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.service.OrderService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
@RequiredArgsConstructor
public class OrderController {

    private final OrderService orderService;

    @PostMapping
    public ApiResponse<OrderResponse> create(@Valid @RequestBody CreateOrderRequest req) {
        return ApiResponse.ok(orderService.create(req));
    }

    @GetMapping("/{orderNo}")
    public ApiResponse<OrderResponse> detail(@PathVariable String orderNo) {
        return ApiResponse.ok(orderService.get(orderNo));
    }

    @GetMapping
    public ApiResponse<PageResponse<OrderResponse>> mine(
            @RequestParam(required = false) OrderStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(orderService.mine(status, page, size));
    }

    @PostMapping("/{orderNo}/cancel")
    public ApiResponse<OrderResponse> cancel(@PathVariable String orderNo) {
        return ApiResponse.ok(orderService.cancel(orderNo));
    }

    /** 前端轮询此接口观察状态流转 */
    @GetMapping("/{orderNo}/status")
    public ApiResponse<java.util.Map<String, Object>> status(@PathVariable String orderNo) {
        OrderResponse order = orderService.get(orderNo);
        java.util.Map<String, Object> map = new java.util.HashMap<>();
        map.put("orderNo", order.orderNo());
        map.put("status", order.status());
        map.put("updatedAt", String.valueOf(order.updatedAt()));
        return ApiResponse.ok(map);
    }
}
