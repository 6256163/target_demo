package com.demo.shop.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** 兜底补偿：MQ 不可用时仍保证超时订单被关闭 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrderCompensationJob {

    private final OrderService orderService;

    @Value("${shop.order.pay-timeout-ms}")
    private long payTimeoutMs;

    @Scheduled(fixedDelayString = "${shop.order.compensate-interval-ms:60000}")
    public void compensate() {
        int n = orderService.compensateExpiredOrders(
                LocalDateTime.now().minusNanos(payTimeoutMs * 1_000_000L), 200);
        if (n > 0) {
            log.info("compensated expired orders: {}", n);
        }
    }
}
