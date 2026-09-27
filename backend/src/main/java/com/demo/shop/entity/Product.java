package com.demo.shop.entity;

import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import jakarta.persistence.Version;

import java.math.BigDecimal;

@Getter
@Setter
@Entity
@Table(name = "products", indexes = {@Index(columnList = "category_id"), @Index(columnList = "status")})
public class Product extends BaseEntity {

    @Column(nullable = false, length = 128)
    private String name;

    @Column(length = 512)
    private String description;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal price;

    @Column(nullable = false)
    private Integer stock = 0;

    @Column(length = 255)
    private String imageUrl;

    @Column(name = "category_id")
    private Long categoryId;

    /** ON_SALE / OFF_SALE */
    @Column(nullable = false, length = 16)
    private String status = "ON_SALE";

    /** 乐观锁版本号：扣库存并发压测时的关键字段 */
    @Version
    @Column(nullable = false)
    private Long version = 0L;
}
