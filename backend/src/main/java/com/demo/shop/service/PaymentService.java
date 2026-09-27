package com.demo.shop.service;

import com.demo.shop.common.BizException;
import com.demo.shop.common.ErrorCode;
import com.demo.shop.common.enums.*;
import com.demo.shop.dto.request.PayRequest;
import com.demo.shop.dto.request.PaymentConfigRequest;
import com.demo.shop.dto.response.PaymentConfigResponse;
import com.demo.shop.dto.response.PaymentResponse;
import com.demo.shop.entity.Order;
import com.demo.shop.entity.Payment;
import com.demo.shop.entity.PaymentConfig;
import com.demo.shop.entity.User;
import com.demo.shop.mq.OrderEventPublisher;
import com.demo.shop.repository.OrderRepository;
import com.demo.shop.repository.PaymentConfigRepository;
import com.demo.shop.repository.PaymentRepository;
import com.demo.shop.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Mock 支付网关：完整状态机 + 可运行时配置的延迟/失败率，支持同步与异步（MQ）两种模式。
 * 状态迁移：PROCESSING -> SUCCESS / FAILED / TIMEOUT ->（退款）REFUNDED
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentRepository paymentRepository;
    private final PaymentConfigRepository configRepository;
    private final OrderRepository orderRepository;
    private final UserRepository userRepository;
    private final OrderEventPublisher publisher;

    @Value("${shop.payment.default-failure-rate}")
    private double defaultFailureRate;
    @Value("${shop.payment.default-timeout-rate}")
    private double defaultTimeoutRate;
    @Value("${shop.payment.default-min-delay-ms}")
    private int defaultMinDelayMs;
    @Value("${shop.payment.default-max-delay-ms}")
    private int defaultMaxDelayMs;

    private final OrderService orderService;

    // ---------- 配置 ----------

    public PaymentConfigResponse getConfig() {
        return PaymentConfigResponse.from(loadConfig());
    }

    @Transactional
    public PaymentConfigResponse updateConfig(PaymentConfigRequest req) {
        PaymentConfig cfg = loadConfig();
        if (req.getFailureRate() != null) cfg.setFailureRate(req.getFailureRate());
        if (req.getTimeoutRate() != null) cfg.setTimeoutRate(req.getTimeoutRate());
        if (req.getMinDelayMs() != null) cfg.setMinDelayMs(req.getMinDelayMs());
        if (req.getMaxDelayMs() != null) cfg.setMaxDelayMs(req.getMaxDelayMs());
        if (req.getAsyncEnabled() != null) cfg.setAsyncEnabled(req.getAsyncEnabled());
        if (cfg.getMinDelayMs() > cfg.getMaxDelayMs()) {
            throw new BizException(ErrorCode.BAD_REQUEST, "minDelayMs 不能大于 maxDelayMs");
        }
        return PaymentConfigResponse.from(configRepository.save(cfg));
    }

    @Transactional(readOnly = true)
    public PaymentConfig loadConfig() {
        return configRepository.findFirstByNameOrderByIdAsc("default").orElseGet(() -> {
            PaymentConfig cfg = new PaymentConfig();
            cfg.setFailureRate(defaultFailureRate);
            cfg.setTimeoutRate(defaultTimeoutRate);
            cfg.setMinDelayMs(defaultMinDelayMs);
            cfg.setMaxDelayMs(defaultMaxDelayMs);
            return configRepository.save(cfg);
        });
    }

    // ---------- 下单支付 ----------

    @Transactional
    public PaymentResponse pay(Long userId, PayRequest req) {
        Order order = orderRepository.findByOrderNo(req.orderNo())
                .orElseThrow(() -> new BizException(ErrorCode.ORDER_NOT_FOUND));
        if (!order.getUserId().equals(userId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "不能支付他人订单");
        }
        if (order.getStatus() != OrderStatus.PENDING_PAYMENT
                && order.getStatus() != OrderStatus.PAYING
                && order.getStatus() != OrderStatus.PAY_FAILED) {
            throw new BizException(ErrorCode.PAYMENT_STATUS_INVALID,
                    "订单状态 " + order.getStatus() + " 不可支付");
        }

        PaymentConfig cfg = loadConfig();
        PayType payType = req.payType() == null ? PayType.ALIPAY : req.payType();

        // 幂等：同一订单存在处理中的支付单则直接返回
        if (order.getStatus() == OrderStatus.PAYING) {
            var processing = paymentRepository.findByOrderNoAndStatus(order.getOrderNo(), PaymentStatus.PROCESSING)
                    .stream().findFirst();
            if (processing.isPresent()) {
                return PaymentResponse.from(processing.get());
            }
        }

        if (payType == PayType.BALANCE) {
            User user = userRepository.findById(userId).orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND));
            if (user.getBalance().compareTo(order.getPayAmount()) < 0) {
                throw new BizException(ErrorCode.BALANCE_NOT_ENOUGH);
            }
            user.setBalance(user.getBalance().subtract(order.getPayAmount()));
            userRepository.save(user);
        }

        Payment payment = new Payment();
        payment.setTradeNo("PAY" + UUID.randomUUID().toString().replace("-", "").substring(0, 20).toUpperCase());
        payment.setOrderNo(order.getOrderNo());
        payment.setUserId(userId);
        payment.setPayType(payType);
        payment.setStatus(PaymentStatus.PROCESSING);
        payment.setAmount(order.getPayAmount());
        PaymentOutcome outcome = decideOutcome(req.outcome(), cfg);
        payment.setRequestedOutcome(outcome.name());
        Payment saved = paymentRepository.save(payment);

        orderService.markPaying(order.getOrderNo());

        if (Boolean.FALSE.equals(cfg.getAsyncEnabled())) {
            // 同步模式：立即（含模拟耗时）落终态
            sleepRandomDelay(cfg);
            return PaymentResponse.from(finish(saved, outcome));
        }
        publisher.afterCommit(() -> publisher.publishPaymentCreated(saved.getTradeNo()));
        return PaymentResponse.from(saved);
    }

    /** 由消费者调用：延迟结束后落到终态 */
    @Transactional
    public Payment finish(String tradeNo, PaymentOutcome outcome) {
        Payment payment = paymentRepository.findByTradeNo(tradeNo)
                .orElseThrow(() -> new BizException(ErrorCode.PAYMENT_NOT_FOUND));
        if (payment.getStatus() != PaymentStatus.PROCESSING) {
            return payment; // 幂等
        }
        return finish(payment, outcome);
    }

    @Transactional
    public Payment finish(Payment payment, PaymentOutcome outcome) {
        PaymentConfig cfg = loadConfig();
        switch (payment.getStatus()) {
            case PROCESSING -> {
            }
            default -> {
                return payment;
            }
        }
        switch (outcome) {
            case SUCCESS -> {
                payment.setStatus(PaymentStatus.SUCCESS);
                payment.setGatewayCode("SUCCESS");
                payment.setGatewayMessage("支付成功");
                paymentRepository.save(payment);
                orderService.markPaid(payment.getOrderNo());
            }
            case FAILED -> {
                payment.setStatus(PaymentStatus.FAILED);
                payment.setGatewayCode("PAY_FAIL");
                payment.setGatewayMessage("支付失败：mock 网关返回失败");
                paymentRepository.save(payment);
                orderService.markPayFailed(payment.getOrderNo());
            }
            case TIMEOUT -> {
                payment.setStatus(PaymentStatus.TIMEOUT);
                payment.setGatewayCode("TIMEOUT");
                payment.setGatewayMessage("支付超时");
                paymentRepository.save(payment);
                // 超时不直接失败，允许重新发起支付
                orderService.markPayFailed(payment.getOrderNo());
            }
            default -> finish(payment, PaymentOutcome.SUCCESS);
        }
        return payment;
    }

    @Transactional(readOnly = true)
    public PaymentResponse get(String tradeNo) {
        return PaymentResponse.from(paymentRepository.findByTradeNo(tradeNo)
                .orElseThrow(() -> new BizException(ErrorCode.PAYMENT_NOT_FOUND)));
    }

    @Transactional(readOnly = true)
    public List<PaymentResponse> listByOrder(String orderNo) {
        return paymentRepository.findByOrderNoOrderByCreatedAtDesc(orderNo)
                .stream().map(PaymentResponse::from).toList();
    }

    /** 模拟第三方支付回调，callbackId 用于幂等 */
    @Transactional
    public PaymentResponse callback(String tradeNo, PaymentStatus status, String callbackId) {
        Payment payment = paymentRepository.findByTradeNo(tradeNo)
                .orElseThrow(() -> new BizException(ErrorCode.PAYMENT_NOT_FOUND));
        if (callbackId != null && callbackId.equals(payment.getCallbackId())) {
            return PaymentResponse.from(payment); // 重复回调直接返回
        }
        if (payment.getStatus() != PaymentStatus.PROCESSING) {
            return PaymentResponse.from(payment);
        }
        payment.setCallbackId(callbackId);
        PaymentOutcome outcome = switch (status) {
            case SUCCESS -> PaymentOutcome.SUCCESS;
            case FAILED -> PaymentOutcome.FAILED;
            case TIMEOUT -> PaymentOutcome.TIMEOUT;
            default -> throw new BizException(ErrorCode.BAD_REQUEST, "不支持的回调状态: " + status);
        };
        return PaymentResponse.from(finish(payment, outcome));
    }

    @Transactional
    public PaymentResponse refund(String tradeNo) {
        Payment payment = paymentRepository.findByTradeNo(tradeNo)
                .orElseThrow(() -> new BizException(ErrorCode.PAYMENT_NOT_FOUND));
        if (payment.getStatus() != PaymentStatus.SUCCESS) {
            throw new BizException(ErrorCode.PAYMENT_STATUS_INVALID, "只有支付成功的单据可以退款");
        }
        payment.setStatus(PaymentStatus.REFUNDED);
        payment.setGatewayCode("REFUND_OK");
        payment.setGatewayMessage("已退款");
        Payment saved = paymentRepository.save(payment);
        orderService.markRefunded(payment.getOrderNo());
        if (payment.getPayType() == PayType.BALANCE) {
            userRepository.findById(payment.getUserId()).ifPresent(u -> {
                u.setBalance(u.getBalance().add(payment.getAmount()));
                userRepository.save(u);
            });
        }
        return PaymentResponse.from(saved);
    }

    // ---------- internal ----------

    public PaymentOutcome decideOutcome(PaymentOutcome requested, PaymentConfig cfg) {
        if (requested != null && requested != PaymentOutcome.RANDOM) {
            return requested;
        }
        double roll = ThreadLocalRandom.current().nextDouble();
        if (roll < cfg.getTimeoutRate()) return PaymentOutcome.TIMEOUT;
        if (roll < cfg.getTimeoutRate() + cfg.getFailureRate()) return PaymentOutcome.FAILED;
        return PaymentOutcome.SUCCESS;
    }

    public void sleepRandomDelay(PaymentConfig cfg) {
        int min = Math.max(0, Math.min(cfg.getMinDelayMs(), cfg.getMaxDelayMs()));
        int max = Math.max(min, Math.max(cfg.getMinDelayMs(), cfg.getMaxDelayMs()));
        long delay = min + (long) (ThreadLocalRandom.current().nextDouble() * (max - min + 1));
        try {
            Thread.sleep(delay);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

}
