package com.demo.shop.entity;

import com.demo.shop.common.enums.PayType;
import com.demo.shop.common.enums.PaymentStatus;
import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Getter
@Setter
@Entity
@Table(name = "payments", uniqueConstraints = @UniqueConstraint(columnNames = "trade_no"),
        indexes = {@Index(columnList = "order_no"), @Index(columnList = "status")})
public class Payment extends BaseEntity {

    @Column(name = "trade_no", nullable = false, length = 40)
    private String tradeNo;

    @Column(name = "order_no", nullable = false, length = 32)
    private String orderNo;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PayType payType = PayType.ALIPAY;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private PaymentStatus status = PaymentStatus.PROCESSING;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount = BigDecimal.ZERO;

    /** mock 网关返回码 */
    @Column(length = 32)
    private String gatewayCode;

    @Column(length = 255)
    private String gatewayMessage;

    /** 幂等校验用：网关回调流水 */
    @Column(length = 64)
    private String callbackId;

    /** 发起支付时指定的 mock 结果（如未指定则由失败率随机决定） */
    @Column(length = 16)
    private String requestedOutcome;
}
