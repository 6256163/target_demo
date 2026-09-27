package com.demo.shop.mq;

import com.demo.shop.service.OrderService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import java.util.Map;

/** 延迟队列 TTL 到期后经死信路由到此：超时未支付则关单并回滚库存 */
@Slf4j
@Component
@RequiredArgsConstructor
public class OrderLifecycleConsumer {

    private final OrderService orderService;

    @RabbitListener(queues = MqConstants.Q_AUTOCANCEL)
    public void autoCancel(Map<String, String> body) {
        orderService.autoCancelIfUnpaid(body.get("orderNo"));
    }

    @RabbitListener(queues = MqConstants.Q_SHIP)
    public void ship(Map<String, String> body) {
        orderService.markShipped(body.get("orderNo"));
    }

    @RabbitListener(queues = MqConstants.Q_DELIVER)
    public void deliver(Map<String, String> body) {
        orderService.markDelivered(body.get("orderNo"));
    }

    /** 支付成功事件：这里只做落日志，后续可挂积分/通知等下游逻辑 */
    @RabbitListener(queues = MqConstants.Q_ORDER_PAID)
    public void paid(Map<String, String> body) {
        log.debug("order paid: {}", body.get("orderNo"));
    }
}
