package com.demo.shop.mq;

/** MQ 常量：所有交换机、队列、路由键集中定义，压测时便于在管理台观察堆积 */
public final class MqConstants {

    private MqConstants() {
    }

    public static final String EXCHANGE = "shop.topic";

    public static final String Q_PAYMENT_PROCESS = "q.payment.process";
    public static final String RK_PAYMENT_CREATED = "payment.created";

    public static final String Q_AUTOCANCEL_DELAY = "q.order.autocancel.delay";
    public static final String Q_AUTOCANCEL = "q.order.autocancel";
    public static final String RK_ORDER_AUTOCANCEL = "order.autocancel";

    public static final String Q_ORDER_PAID = "q.order.paid";
    public static final String RK_ORDER_PAID = "order.paid";

    public static final String Q_SHIP_DELAY = "q.order.ship.delay";
    public static final String Q_SHIP = "q.order.ship";
    public static final String RK_ORDER_SHIP = "order.ship";

    public static final String Q_DELIVER_DELAY = "q.order.deliver.delay";
    public static final String Q_DELIVER = "q.order.deliver";
    public static final String RK_ORDER_DELIVER = "order.deliver";
}
