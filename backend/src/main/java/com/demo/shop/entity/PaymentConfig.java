package com.demo.shop.entity;

import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** Mock 网关行为配置，可在运行时通过 admin 接口调整，用于压测不同失败率与响应时延 */
@Getter
@Setter
@Entity
@Table(name = "payment_config")
public class PaymentConfig extends BaseEntity {

    @Column(nullable = false, length = 32)
    private String name = "default";

    /** 随机失败概率 0~1 */
    @Column(nullable = false)
    private Double failureRate = 0.05;

    /** 随机超时概率 0~1 */
    @Column(nullable = false)
    private Double timeoutRate = 0.03;

    @Column(nullable = false)
    private Integer minDelayMs = 300;

    @Column(nullable = false)
    private Integer maxDelayMs = 2000;

    /** 是否启用延迟队列异步处理；关闭则同步返回，方便做对照实验 */
    @Column(nullable = false)
    private Boolean asyncEnabled = Boolean.TRUE;
}
