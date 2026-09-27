package com.demo.shop.repository;

import com.demo.shop.entity.PaymentConfig;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface PaymentConfigRepository extends JpaRepository<PaymentConfig, Long> {
    Optional<PaymentConfig> findFirstByNameOrderByIdAsc(String name);
}
