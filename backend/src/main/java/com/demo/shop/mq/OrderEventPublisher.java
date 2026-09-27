package com.demo.shop.mq;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class OrderEventPublisher {

    private final RabbitTemplate rabbitTemplate;

    /**
     * 事务提交后再投递消息。
     * 若在事务内直接发消息，消费者可能先于提交读到数据，出现 "payment not found" / 状态流转丢失。
     */
    public void afterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }

    public void publishPaymentCreated(String tradeNo) {
        rabbitTemplate.convertAndSend(MqConstants.EXCHANGE, MqConstants.RK_PAYMENT_CREATED,
                Map.of("tradeNo", tradeNo));
    }

    /** 下单成功 -> 投递延迟队列，超时后由死信路由到自动关单队列 */
    public void scheduleAutoCancel(String orderNo) {
        rabbitTemplate.convertAndSend(MqConstants.EXCHANGE, MqConstants.Q_AUTOCANCEL_DELAY,
                Map.of("orderNo", orderNo));
    }

    /** 支付成功 -> 发货流程 */
    public void publishOrderPaid(String orderNo) {
        rabbitTemplate.convertAndSend(MqConstants.EXCHANGE, MqConstants.RK_ORDER_PAID,
                Map.of("orderNo", orderNo));
    }

    public void scheduleShip(String orderNo) {
        rabbitTemplate.convertAndSend(MqConstants.EXCHANGE, MqConstants.Q_SHIP_DELAY,
                Map.of("orderNo", orderNo));
    }

    public void scheduleDeliver(String orderNo) {
        rabbitTemplate.convertAndSend(MqConstants.EXCHANGE, MqConstants.Q_DELIVER_DELAY,
                Map.of("orderNo", orderNo));
    }
}
