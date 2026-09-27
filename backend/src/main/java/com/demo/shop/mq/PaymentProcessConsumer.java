package com.demo.shop.mq;

import com.demo.shop.common.enums.PaymentOutcome;
import com.demo.shop.entity.Payment;
import com.demo.shop.repository.PaymentRepository;
import com.demo.shop.service.PaymentService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 模拟第三方支付网关的异步处理：先按配置睡眠（放大下游耗时），再决定 SUCCESS/FAILED/TIMEOUT。
 * 消费速度慢造成的队列堆积，是性能压测时可观测的关键指标之一。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PaymentProcessConsumer {

    private final PaymentService paymentService;
    private final PaymentRepository paymentRepository;

    @RabbitListener(queues = MqConstants.Q_PAYMENT_PROCESS, concurrency = "${MQ_PAY_CONSUMER:2}-${MQ_PAY_CONSUMER_MAX:4}")
    public void handle(Map<String, String> body) {
        String tradeNo = body.get("tradeNo");
        if (tradeNo == null) {
            log.warn("bad payment message: {}", body);
            return;
        }

        Payment payment = paymentRepository.findByTradeNo(tradeNo).orElse(null);
        if (payment == null) {
            log.warn("payment not found: {}", tradeNo);
            return;
        }
        paymentService.sleepRandomDelay(paymentService.loadConfig());
        PaymentOutcome requested = payment.getRequestedOutcome() == null
                ? null : PaymentOutcome.valueOf(payment.getRequestedOutcome());
        PaymentOutcome outcome = paymentService.decideOutcome(requested, paymentService.loadConfig());
        Payment finished = paymentService.finish(tradeNo, outcome);
        log.debug("payment finished: {} -> {}", tradeNo, finished.getStatus());
    }
}
