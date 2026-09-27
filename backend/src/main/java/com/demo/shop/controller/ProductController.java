package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.dto.response.ProductResponse;
import com.demo.shop.service.ProductService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/products")
@RequiredArgsConstructor
public class ProductController {

    private final ProductService productService;

    @Operation(summary = "商品分页列表（支持关键字/分类筛选）")
    @GetMapping
    public ApiResponse<PageResponse<ProductResponse>> list(
            @RequestParam(defaultValue = "") String keyword,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(productService.list(keyword, categoryId, page, size));
    }

    @Operation(summary = "商品详情（走 Redis 缓存，返回 cached 标记便于观测命中率）")
    @GetMapping("/{id}")
    public ApiResponse<ProductResponse> detail(@PathVariable Long id) {
        return ApiResponse.ok(productService.detail(id));
    }

    @Operation(summary = "热销商品（压测热点数据场景用）")
    @GetMapping("/hot")
    public ApiResponse<List<ProductResponse>> hot(@RequestParam(defaultValue = "10") int limit) {
        return ApiResponse.ok(productService.hotProducts(limit));
    }
}
