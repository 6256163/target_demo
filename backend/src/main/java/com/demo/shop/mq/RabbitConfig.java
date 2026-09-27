package com.demo.shop.mq;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.core.*;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 延迟关单通过「TTL + 死信交换机」实现（不依赖 rabbitmq_delayed_message_exchange 插件），
 * 这样任意 RabbitMQ 官方镜像都能直接跑起来。
 */
@Configuration
public class RabbitConfig {

    @Value("${shop.order.pay-timeout-ms}")
    private long payTimeoutMs;

    @Value("${shop.order.auto-ship-delay-ms}")
    private long shipDelayMs;

    /**
     * 统一用 JSON 序列化：默认的 SimpleMessageConverter 走 JDK 序列化，
     * 消费端会被 Spring AMQP 的 allowed-list 拦截（压测时表现为支付单永远卡在 PROCESSING）。
     */
    @Bean
    public MessageConverter jacksonMessageConverter(ObjectMapper objectMapper) {
        return new Jackson2JsonMessageConverter(objectMapper);
    }

    @Bean
    public TopicExchange shopExchange() {
        return ExchangeBuilder.topicExchange(MqConstants.EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue paymentProcessQueue() {
        return QueueBuilder.durable(MqConstants.Q_PAYMENT_PROCESS).build();
    }

    @Bean
    public Binding paymentProcessBinding() {
        return BindingBuilder.bind(paymentProcessQueue()).to(shopExchange()).with(MqConstants.RK_PAYMENT_CREATED);
    }

    @Bean
    public Queue autoCancelDelayQueue() {
        return QueueBuilder.durable(MqConstants.Q_AUTOCANCEL_DELAY)
                .ttl((int) payTimeoutMs)
                .deadLetterExchange(MqConstants.EXCHANGE)
                .deadLetterRoutingKey(MqConstants.RK_ORDER_AUTOCANCEL)
                .build();
    }

    @Bean
    public Queue autoCancelQueue() {
        return QueueBuilder.durable(MqConstants.Q_AUTOCANCEL).build();
    }

    @Bean
    public Binding autoCancelBinding() {
        return BindingBuilder.bind(autoCancelQueue()).to(shopExchange()).with(MqConstants.RK_ORDER_AUTOCANCEL);
    }

    /** 延迟队列本身也要绑到交换机，routing key 用队列名，便于管理台区分 */
    @Bean
    public Binding autoCancelDelayBinding() {
        return BindingBuilder.bind(autoCancelDelayQueue()).to(shopExchange()).with(MqConstants.Q_AUTOCANCEL_DELAY);
    }

    @Bean
    public Queue shipDelayQueue() {
        return QueueBuilder.durable(MqConstants.Q_SHIP_DELAY)
                .ttl((int) shipDelayMs)
                .deadLetterExchange(MqConstants.EXCHANGE)
                .deadLetterRoutingKey(MqConstants.RK_ORDER_SHIP)
                .build();
    }

    @Bean
    public Queue shipQueue() {
        return QueueBuilder.durable(MqConstants.Q_SHIP).build();
    }

    @Bean
    public Binding shipBinding() {
        return BindingBuilder.bind(shipQueue()).to(shopExchange()).with(MqConstants.RK_ORDER_SHIP);
    }

    @Bean
    public Binding shipDelayBinding() {
        return BindingBuilder.bind(shipDelayQueue()).to(shopExchange()).with(MqConstants.Q_SHIP_DELAY);
    }

    @Bean
    public Queue deliverDelayQueue() {
        return QueueBuilder.durable(MqConstants.Q_DELIVER_DELAY)
                .ttl((int) shipDelayMs)
                .deadLetterExchange(MqConstants.EXCHANGE)
                .deadLetterRoutingKey(MqConstants.RK_ORDER_DELIVER)
                .build();
    }

    @Bean
    public Queue deliverQueue() {
        return QueueBuilder.durable(MqConstants.Q_DELIVER).build();
    }

    @Bean
    public Binding deliverBinding() {
        return BindingBuilder.bind(deliverQueue()).to(shopExchange()).with(MqConstants.RK_ORDER_DELIVER);
    }

    @Bean
    public Binding deliverDelayBinding() {
        return BindingBuilder.bind(deliverDelayQueue()).to(shopExchange()).with(MqConstants.Q_DELIVER_DELAY);
    }

    @Bean
    public Queue orderPaidQueue() {
        return QueueBuilder.durable(MqConstants.Q_ORDER_PAID).build();
    }

    @Bean
    public Binding orderPaidBinding() {
        return BindingBuilder.bind(orderPaidQueue()).to(shopExchange()).with(MqConstants.RK_ORDER_PAID);
    }
}
