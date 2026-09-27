package com.demo.shop.entity;

import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "cart_items", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "product_id"}))
public class CartItem extends BaseEntity {

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "product_id", nullable = false)
    private Long productId;

    @Column(nullable = false)
    private Integer quantity = 1;

    /** 加入购物车时的价格快照，便于验证“价格变动”场景 */
    @Column(nullable = false, precision = 12, scale = 2)
    private java.math.BigDecimal snapshotPrice;
}
