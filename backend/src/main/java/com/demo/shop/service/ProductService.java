package com.demo.shop.service;

import com.demo.shop.common.BizException;
import com.demo.shop.common.ErrorCode;
import com.demo.shop.dto.request.ProductUpsertRequest;
import com.demo.shop.dto.request.StockAdjustRequest;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.dto.response.ProductResponse;
import com.demo.shop.entity.Product;
import com.demo.shop.repository.ProductRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 商品读多写少，用 Cache-Aside + 空值缓存 + TTL 随机抖动 + 互斥锁重建，
 * 便于在压测里复现缓存击穿 / 穿透 / 雪崩。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductService {

    private static final String KEY_PREFIX = "shop:product:";
    private static final String LOCK_PREFIX = "shop:lock:product:";
    private static final String NULL_VALUE = "__NULL__";

    private final ProductRepository productRepository;
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${shop.cache.product-ttl-seconds}")
    private long productTtlSeconds;

    @Value("${shop.cache.product-null-ttl-seconds}")
    private long nullTtlSeconds;

    public PageResponse<ProductResponse> list(String keyword, Long categoryId, int page, int size) {
        PageRequest pageable = PageRequest.of(Math.max(page, 0), Math.min(size, 200));
        Page<Product> result = productRepository.search(keyword, categoryId, pageable);
        return PageResponse.of(result, result.getContent().stream().map(ProductResponse::from).toList());
    }

    @Transactional(readOnly = true)
    public ProductResponse detail(Long id) {
        String key = KEY_PREFIX + id;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            if (NULL_VALUE.equals(cached)) {
                throw new BizException(ErrorCode.PRODUCT_NOT_FOUND);
            }
            return readJson(cached, true);
        }

        // 缓存重建互斥锁，防止热点商品过期瞬间击穿到 DB
        String lockKey = LOCK_PREFIX + id;
        boolean locked = Boolean.TRUE.equals(
                redis.opsForValue().setIfAbsent(lockKey, "1", Duration.ofSeconds(5)));
        try {
            if (!locked) {
                for (int i = 0; i < 10; i++) {
                    Thread.sleep(20);
                    String retry = redis.opsForValue().get(key);
                    if (retry != null) {
                        if (NULL_VALUE.equals(retry)) {
                            throw throwNotFound();
                        }
                        return readJson(retry, true);
                    }
                }
            }
            Product product = productRepository.findById(id).orElse(null);
            if (product == null) {
                redis.opsForValue().set(key, NULL_VALUE, Duration.ofSeconds(nullTtlSeconds));
                throw throwNotFound();
            }
            ProductResponse resp = ProductResponse.from(product);
            // TTL 随机抖动，避免大批量 key 同时过期导致雪崩
            long ttl = productTtlSeconds + ThreadLocalRandom.current().nextLong(60);
            redis.opsForValue().set(key, writeJson(resp), Duration.ofSeconds(ttl));
            return resp;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new BizException(ErrorCode.INTERNAL_ERROR, "缓存重建被中断");
        } finally {
            if (locked) {
                redis.delete(lockKey);
            }
        }
    }

    @Transactional
    public ProductResponse create(ProductUpsertRequest req) {
        Product p = new Product();
        apply(p, req);
        Product saved = productRepository.save(p);
        return ProductResponse.from(saved);
    }

    @Transactional
    public ProductResponse update(Long id, ProductUpsertRequest req) {
        Product p = productRepository.findById(id).orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
        apply(p, req);
        Product saved = productRepository.save(p);
        evict(id);
        return ProductResponse.from(saved);
    }

    @Transactional
    public void delete(Long id) {
        Product p = productRepository.findById(id).orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
        productRepository.delete(p);
        evict(id);
    }

    @Transactional
    public ProductResponse adjustStock(Long id, StockAdjustRequest req) {
        Product p = productRepository.findById(id).orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
        int next = p.getStock() + req.delta();
        if (next < 0) {
            throw new BizException(ErrorCode.STOCK_NOT_ENOUGH, "调整后库存不能为负");
        }
        p.setStock(next);
        Product saved = productRepository.save(p);
        evict(id);
        return ProductResponse.from(saved);
    }

    public List<ProductResponse> hotProducts(int limit) {
        return productRepository.findByStatus("ON_SALE", PageRequest.of(0, limit))
                .getContent().stream().map(ProductResponse::from).toList();
    }

    public void evict(Long productId) {
        redis.delete(KEY_PREFIX + productId);
    }

    private void apply(Product p, ProductUpsertRequest req) {
        p.setName(req.getName());
        p.setDescription(req.getDescription());
        p.setPrice(req.getPrice());
        p.setStock(req.getStock());
        p.setImageUrl(req.getImageUrl());
        p.setCategoryId(req.getCategoryId());
        p.setStatus(req.getStatus() == null ? "ON_SALE" : req.getStatus());
    }

    private ProductResponse readJson(String json, boolean cached) {
        try {
            ProductResponse base = objectMapper.readValue(json, ProductResponse.class);
            return new ProductResponse(base.id(), base.name(), base.description(), base.price(),
                    base.stock(), base.imageUrl(), base.categoryId(), base.status(), cached);
        } catch (Exception e) {
            log.warn("broken product cache, evict: {}", e.getMessage());
            return null;
        }
    }

    private String writeJson(ProductResponse resp) {
        try {
            return objectMapper.writeValueAsString(resp);
        } catch (Exception e) {
            throw new BizException(ErrorCode.INTERNAL_ERROR, "序列化商品缓存失败");
        }
    }

    private BizException throwNotFound() {
        return new BizException(ErrorCode.PRODUCT_NOT_FOUND);
    }
}
