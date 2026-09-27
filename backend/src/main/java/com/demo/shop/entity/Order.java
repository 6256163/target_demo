package com.demo.shop.entity;

import com.demo.shop.common.enums.OrderStatus;
import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@Entity
@Table(name = "orders", uniqueConstraints = @UniqueConstraint(columnNames = "order_no"),
        indexes = {@Index(columnList = "user_id"), @Index(columnList = "status"), @Index(columnList = "created_at")})
public class Order extends BaseEntity {

    @Column(name = "order_no", nullable = false, length = 32)
    private String orderNo;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private OrderStatus status = OrderStatus.PENDING_PAYMENT;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal totalAmount = BigDecimal.ZERO;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal payAmount = BigDecimal.ZERO;

    @Column(nullable = false)
    private Integer totalQuantity = 0;

    @Column(length = 255)
    private String receiverName;

    @Column(length = 32)
    private String receiverPhone;

    @Column(length = 512)
    private String receiverAddress;

    @Column(length = 255)
    private String remark;

    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @OrderBy("id ASC")
    private List<OrderItem> items = new ArrayList<>();

    public void addItem(OrderItem item) {
        items.add(item);
        item.setOrder(this);
    }
}
