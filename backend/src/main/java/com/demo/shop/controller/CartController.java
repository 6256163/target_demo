package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.dto.request.CartItemRequest;
import com.demo.shop.dto.response.CartResponse;
import com.demo.shop.service.CartService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/cart")
@RequiredArgsConstructor
public class CartController {

    private final CartService cartService;

    @GetMapping
    public ApiResponse<CartResponse> view() {
        return ApiResponse.ok(cartService.view());
    }

    @PostMapping("/items")
    public ApiResponse<CartResponse> add(@Valid @RequestBody CartItemRequest req) {
        return ApiResponse.ok(cartService.add(req));
    }

    @PutMapping("/items/{productId}")
    public ApiResponse<CartResponse> update(@PathVariable Long productId,
                                            @RequestBody java.util.Map<String, Integer> body) {
        return ApiResponse.ok(cartService.updateQuantity(productId, body.get("quantity")));
    }

    @DeleteMapping("/items/{productId}")
    public ApiResponse<CartResponse> remove(@PathVariable Long productId) {
        return ApiResponse.ok(cartService.remove(productId));
    }

    @DeleteMapping
    public ApiResponse<CartResponse> clear() {
        return ApiResponse.ok(cartService.clear());
    }
}
