package com.demo.shop.service;

import com.demo.shop.common.BizException;
import com.demo.shop.common.ErrorCode;
import com.demo.shop.config.security.CurrentUser;
import com.demo.shop.dto.request.CartItemRequest;
import com.demo.shop.dto.response.CartItemResponse;
import com.demo.shop.dto.response.CartResponse;
import com.demo.shop.entity.CartItem;
import com.demo.shop.entity.Product;
import com.demo.shop.repository.CartItemRepository;
import com.demo.shop.repository.ProductRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CartService {

    private final CartItemRepository cartItemRepository;
    private final ProductRepository productRepository;

    @Transactional(readOnly = true)
    public CartResponse view() {
        Long userId = CurrentUser.id();
        List<CartItem> items = cartItemRepository.findByUserIdOrderByIdDesc(userId);
        List<CartItemResponse> resp = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        int qty = 0;
        for (CartItem item : items) {
            Product p = productRepository.findById(item.getProductId()).orElse(null);
            BigDecimal subtotal = item.getSnapshotPrice().multiply(BigDecimal.valueOf(item.getQuantity()));
            resp.add(new CartItemResponse(item.getId(), item.getProductId(),
                    p == null ? "(已下架)" : p.getName(),
                    item.getSnapshotPrice(), item.getQuantity(), subtotal,
                    p == null ? 0 : p.getStock()));
            total = total.add(subtotal);
            qty += item.getQuantity();
        }
        return new CartResponse(resp, total, qty);
    }

    @Transactional
    public CartResponse add(CartItemRequest req) {
        Long userId = CurrentUser.id();
        Product p = productRepository.findById(req.productId())
                .orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
        if (!"ON_SALE".equals(p.getStatus())) {
            throw new BizException(ErrorCode.PRODUCT_OFF_SALE);
        }
        if (p.getStock() < req.quantity()) {
            throw new BizException(ErrorCode.STOCK_NOT_ENOUGH);
        }
        CartItem item = cartItemRepository.findByUserIdAndProductId(userId, req.productId())
                .map(existing -> {
                    existing.setQuantity(existing.getQuantity() + req.quantity());
                    return existing;
                })
                .orElseGet(() -> {
                    CartItem c = new CartItem();
                    c.setUserId(userId);
                    c.setProductId(req.productId());
                    c.setQuantity(req.quantity());
                    c.setSnapshotPrice(p.getPrice());
                    return c;
                });
        cartItemRepository.save(item);
        return view();
    }

    @Transactional
    public CartResponse updateQuantity(Long productId, Integer quantity) {
        Long userId = CurrentUser.id();
        if (quantity <= 0) {
            cartItemRepository.findByUserIdAndProductId(userId, productId)
                    .ifPresent(cartItemRepository::delete);
            return view();
        }
        CartItem item = cartItemRepository.findByUserIdAndProductId(userId, productId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "购物车中没有该商品"));
        item.setQuantity(quantity);
        cartItemRepository.save(item);
        return view();
    }

    @Transactional
    public CartResponse remove(Long productId) {
        Long userId = CurrentUser.id();
        cartItemRepository.findByUserIdAndProductId(userId, productId).ifPresent(cartItemRepository::delete);
        return view();
    }

    @Transactional
    public CartResponse clear() {
        Long userId = CurrentUser.id();
        cartItemRepository.deleteByUserId(userId);
        return view();
    }
}
