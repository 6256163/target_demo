package com.demo.shop.repository;

import com.demo.shop.entity.Payment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    Optional<Payment> findByTradeNo(String tradeNo);

    List<Payment> findByOrderNoOrderByCreatedAtDesc(String orderNo);

    Optional<Payment> findFirstByOrderNoOrderByCreatedAtDesc(String orderNo);

    List<Payment> findByOrderNoAndStatus(String orderNo, com.demo.shop.common.enums.PaymentStatus status);
}
