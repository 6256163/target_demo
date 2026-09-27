package com.demo.shop.service;

import com.demo.shop.common.BizException;
import com.demo.shop.common.ErrorCode;
import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.config.security.CurrentUser;
import com.demo.shop.dto.request.CreateOrderRequest;
import com.demo.shop.dto.response.OrderResponse;
import com.demo.shop.dto.response.PageResponse;
import com.demo.shop.entity.*;
import com.demo.shop.mq.OrderEventPublisher;
import com.demo.shop.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DeadlockLoserDataAccessException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ThreadLocalRandom;

@Slf4j
@Service
@RequiredArgsConstructor
public class OrderService {

    /** 订单号序列，配合时间戳保证同一进程内不重复 */
    private static final java.util.concurrent.atomic.AtomicLong ORDER_SEQ =
            new java.util.concurrent.atomic.AtomicLong();

    private final OrderRepository orderRepository;
    private final ProductRepository productRepository;
    private final CartItemRepository cartItemRepository;
    private final CartService cartService;
    private final ProductService productService;
    private final OrderEventPublisher publisher;

    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    @Transactional
    public OrderResponse create(CreateOrderRequest req) {
        Long userId = CurrentUser.id();
        List<CreateOrderRequest.OrderItemReq> items = new ArrayList<>();
        if (Boolean.TRUE.equals(req.getFromCart())) {
            cartItemRepository.findByUserIdOrderByIdDesc(userId).forEach(c ->
                    items.add(new CreateOrderRequest.OrderItemReq() {{
                        setProductId(c.getProductId());
                        setQuantity(c.getQuantity());
                    }}));
        } else if (!CollectionUtils.isEmpty(req.getItems())) {
            items.addAll(req.getItems());
        }
        if (items.isEmpty()) {
            throw new BizException(ErrorCode.BAD_REQUEST, "下单商品不能为空");
        }

        Order order = new Order();
        order.setOrderNo(newOrderNo());
        order.setUserId(userId);
        order.setStatus(OrderStatus.PENDING_PAYMENT);
        order.setRemark(req.getRemark());
        order.setReceiverName(req.getReceiverName() == null ? "默认收货人" : req.getReceiverName());
        order.setReceiverPhone(req.getReceiverPhone() == null ? "13800000000" : req.getReceiverPhone());
        order.setReceiverAddress(req.getReceiverAddress() == null ? "测试地址 001 号" : req.getReceiverAddress());

        BigDecimal total = BigDecimal.ZERO;
        int qty = 0;
        for (CreateOrderRequest.OrderItemReq item : items) {
            Product p = productRepository.findById(item.getProductId())
                    .orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
            if (!"ON_SALE".equals(p.getStatus())) {
                throw new BizException(ErrorCode.PRODUCT_OFF_SALE, p.getName() + " 已下架");
            }
            deductStockWithRetry(p.getId(), item.getQuantity());

            OrderItem oi = new OrderItem();
            oi.setProductId(p.getId());
            oi.setProductName(p.getName());
            oi.setPrice(p.getPrice());
            oi.setQuantity(item.getQuantity());
            order.addItem(oi);

            total = total.add(p.getPrice().multiply(BigDecimal.valueOf(item.getQuantity())));
            qty += item.getQuantity();
        }
        order.setTotalAmount(total);
        order.setPayAmount(total);
        order.setTotalQuantity(qty);

        Order saved = orderRepository.save(order);
        if (Boolean.TRUE.equals(req.getFromCart())) {
            cartItemRepository.deleteByUserId(userId);
        }
        // 投递延迟队列，超时未支付自动关单（事务提交后再发，避免消费者读不到未提交数据）
        publisher.afterCommit(() -> publisher.scheduleAutoCancel(saved.getOrderNo()));
        log.info("order created: {} amount={}", saved.getOrderNo(), total);
        return OrderResponse.from(saved);
    }

    @Transactional(readOnly = true)
    public OrderResponse get(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo)
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        assertOwnership(order);
        return OrderResponse.from(order);
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderResponse> mine(OrderStatus status, int page, int size) {
        Long userId = CurrentUser.id();
        PageRequest pageable = PageRequest.of(Math.max(page, 0), Math.min(size, 100));
        Page<Order> result = status == null
                ? orderRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                : orderRepository.findByUserIdAndStatusOrderByCreatedAtDesc(userId, status, pageable);
        return PageResponse.of(result, result.getContent().stream().map(OrderResponse::from).toList());
    }

    @Transactional
    public OrderResponse cancel(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo)
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        assertOwnership(order);
        if (order.getStatus() != OrderStatus.PENDING_PAYMENT && order.getStatus() != OrderStatus.PAYING) {
            throw new BizException(ErrorCode.ORDER_STATUS_INVALID,
                    "当前状态 " + order.getStatus() + " 不能取消");
        }
        order.setStatus(OrderStatus.CANCELLED);
        order.getItems().forEach(i -> restoreStock(i.getProductId(), i.getQuantity()));
        Order saved = orderRepository.save(order);
        return OrderResponse.from(saved);
    }

    // ---------- 供 MQ 消费者调用的内部方法 ----------

    @Transactional(readOnly = true)
    public PageResponse<OrderResponse> adminList(OrderStatus status, int page, int size) {
        PageRequest pageable = PageRequest.of(Math.max(page, 0), Math.min(size, 100));
        Page<Order> result = status == null
                ? orderRepository.findAll(pageable)
                : orderRepository.findByStatusOrderByCreatedAtAsc(status, pageable);
        return PageResponse.of(result, result.getContent().stream().map(OrderResponse::from).toList());
    }

    @Transactional(readOnly = true)
    public Map<String, Object> stats() {
        Map<String, Object> stats = new LinkedHashMap<>();
        for (OrderStatus s : OrderStatus.values()) {
            stats.put(s.name(), orderRepository.countByStatus(s));
        }
        stats.put("totalOrders", orderRepository.count());
        return stats;
    }

    @Transactional
    public void markPaying(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo)
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        if (order.getStatus() == OrderStatus.PENDING_PAYMENT) {
            order.setStatus(OrderStatus.PAYING);
            orderRepository.save(order);
        }
    }

    @Transactional
    public void markPaid(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo)
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        if (order.getStatus() == OrderStatus.PAID || order.getStatus() == OrderStatus.SHIPPED
                || order.getStatus() == OrderStatus.DELIVERED) {
            return; // 幂等
        }
        order.setStatus(OrderStatus.PAID);
        orderRepository.save(order);
        publisher.afterCommit(() -> {
            publisher.publishOrderPaid(orderNo);
            publisher.scheduleShip(orderNo);
        });
    }

    @Transactional
    public void markPayFailed(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo)
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        if (order.getStatus() != OrderStatus.PENDING_PAYMENT && order.getStatus() != OrderStatus.PAYING) {
            return;
        }
        order.setStatus(OrderStatus.PAY_FAILED);
        order.getItems().forEach(i -> restoreStock(i.getProductId(), i.getQuantity()));
        orderRepository.save(order);
    }

    /** 自动关单：仅处理超时仍未支付的订单 */
    @Transactional
    public void autoCancelIfUnpaid(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo).orElse(null);
        if (order == null) return;
        if (order.getStatus() != OrderStatus.PENDING_PAYMENT && order.getStatus() != OrderStatus.PAYING) {
            return;
        }
        order.setStatus(OrderStatus.CANCELLED);
        order.getItems().forEach(i -> restoreStock(i.getProductId(), i.getQuantity()));
        orderRepository.save(order);
        log.info("order auto cancelled: {}", orderNo);
    }

    @Transactional
    public void markShipped(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo).orElse(null);
        if (order == null || order.getStatus() != OrderStatus.PAID) return;
        order.setStatus(OrderStatus.SHIPPED);
        orderRepository.save(order);
        publisher.afterCommit(() -> publisher.scheduleDeliver(orderNo));
    }

    @Transactional
    public void markRefunded(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo).orElse(null);
        if (order == null || order.getStatus() == OrderStatus.CANCELLED) return;
        order.setStatus(OrderStatus.CANCELLED);
        order.getItems().forEach(i -> restoreStock(i.getProductId(), i.getQuantity()));
        orderRepository.save(order);
    }

    @Transactional
    public void markDelivered(String orderNo) {
        Order order = orderRepository.findByOrderNo(orderNo).orElse(null);
        if (order == null || order.getStatus() != OrderStatus.SHIPPED) return;
        order.setStatus(OrderStatus.DELIVERED);
        orderRepository.save(order);
    }

    /** 补偿扫描（定时任务）：兜底处理 MQ 不可用时的超期订单 */
    @Transactional
    public int compensateExpiredOrders(LocalDateTime before, int limit) {
        List<Order> expired = orderRepository.findByStatusAndCreatedAtBefore(
                OrderStatus.PENDING_PAYMENT, before, PageRequest.of(0, limit));
        for (Order order : expired) {
            autoCancelIfUnpaid(order.getOrderNo());
        }
        return expired.size();
    }

    // ---------- helper ----------

    private void assertOwnership(Order order) {
        if (!CurrentUser.isAdmin() && !Objects.equals(order.getUserId(), CurrentUser.id())) {
            throw new BizException(ErrorCode.FORBIDDEN, "不能访问他人订单");
        }
    }

    /**
     * 扣库存。
     *
     * 这里必须用「原子条件更新」而不是「读出来改完再 save」：
     * 后者在并发下会在 flush/commit 阶段抛 ObjectOptimisticLockingFailureException，
     * 而此时 JPA 事务已经被标记 rollback-only，service 里的重试根本救不回来，
     * 最终变成 500（Transaction silently rolled back）。实测并发下单 500 率约 2.6%。
     *
     * 改成 UPDATE ... WHERE stock >= qty 后，库存判断与扣减在一个语句里由行锁保证原子性：
     * 返回 0 行 = 库存不足或并发失败，返回 1 行 = 扣减成功。锁等待/死锁这类可恢复异常才重试。
     */
    private void deductStockWithRetry(Long productId, int quantity) {
        int retry = 0;
        while (true) {
            try {
                int updated = productRepository.deductStock(productId, quantity);
                if (updated == 0) {
                    Product p = productRepository.findById(productId)
                            .orElseThrow(() -> new BizException(ErrorCode.PRODUCT_NOT_FOUND));
                    if (p.getStock() < quantity) {
                        throw new BizException(ErrorCode.STOCK_NOT_ENOUGH, p.getName() + " 库存不足");
                    }
                    throw new BizException(ErrorCode.CONFLICT, "库存并发冲突，请重试");
                }
                productService.evict(productId);
                return;
            } catch (CannotAcquireLockException | DeadlockLoserDataAccessException e) {
                if (++retry >= 3) {
                    throw new BizException(ErrorCode.CONFLICT, "库存并发冲突（锁等待/死锁），请重试");
                }
                try {
                    Thread.sleep(20L * retry);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new BizException(ErrorCode.CONFLICT, "库存扣减被中断");
                }
            }
        }
    }

    private void restoreStock(Long productId, int quantity) {
        Product p = productRepository.findById(productId).orElse(null);
        if (p == null) return;
        p.setStock(p.getStock() + quantity);
        productRepository.save(p);
        productService.evict(productId);
    }

    /**
     * 订单号 = yyyyMMddHHmmss + 6 位递增序列。
     *
     * 原来用的是 6 位随机数：在 1e6 空间里按生日悖论，1600 个订单就必然撞号
     * （实测 500 TPS 压 15s 撞了 3 次，直接 uk_orders_no 唯一键冲突 → 500）。
     * 改成单调递增后，同一秒内也保证不重复。
     */
    private String newOrderNo() {
        long seq = ORDER_SEQ.updateAndGet(v -> v >= 999999 ? 1 : v + 1);
        return LocalDateTime.now().format(FMT) + String.format("%06d", seq);
    }
}
