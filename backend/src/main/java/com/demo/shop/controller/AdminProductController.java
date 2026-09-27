package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.dto.request.ProductUpsertRequest;
import com.demo.shop.dto.request.StockAdjustRequest;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.dto.response.ProductResponse;
import com.demo.shop.service.ProductService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/products")
@RequiredArgsConstructor
public class AdminProductController {

    private final ProductService productService;

    @GetMapping
    public ApiResponse<PageResponse<ProductResponse>> list(
            @RequestParam(defaultValue = "") String keyword,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.ok(productService.list(keyword, categoryId, page, size));
    }

    @PostMapping
    public ApiResponse<ProductResponse> create(@Valid @RequestBody ProductUpsertRequest req) {
        return ApiResponse.ok(productService.create(req));
    }

    @PutMapping("/{id}")
    public ApiResponse<ProductResponse> update(@PathVariable Long id,
                                               @Valid @RequestBody ProductUpsertRequest req) {
        return ApiResponse.ok(productService.update(id, req));
    }

    @DeleteMapping("/{id}")
    public ApiResponse<Boolean> delete(@PathVariable Long id) {
        productService.delete(id);
        return ApiResponse.ok(true);
    }

    @PatchMapping("/{id}/stock")
    public ApiResponse<ProductResponse> adjustStock(@PathVariable Long id,
                                                    @RequestBody StockAdjustRequest req) {
        return ApiResponse.ok(productService.adjustStock(id, req));
    }

    @DeleteMapping("/cache")
    public ApiResponse<Boolean> clearCache() {
        return ApiResponse.ok(true);
    }
}
