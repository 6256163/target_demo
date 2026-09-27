package com.demo.shop.repository;

import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.entity.Order;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface OrderRepository extends JpaRepository<Order, Long> {

    Optional<Order> findByOrderNo(String orderNo);

    Page<Order> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    Page<Order> findByUserIdAndStatusOrderByCreatedAtDesc(Long userId, OrderStatus status, Pageable pageable);

    Page<Order> findByStatusOrderByCreatedAtAsc(OrderStatus status, Pageable pageable);

    /** 补偿任务：超时未支付且在时间点之前创建的订单 */
    List<Order> findByStatusAndCreatedAtBefore(OrderStatus status, LocalDateTime before, Pageable pageable);

    long countByUserId(Long userId);

    long countByStatus(OrderStatus status);
}
