package com.demo.shop.entity;

import com.demo.shop.common.enums.Role;
import com.demo.shop.entity.base.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Getter
@Setter
@Entity
@Table(name = "users", uniqueConstraints = @UniqueConstraint(columnNames = "username"),
        indexes = @Index(columnList = "username"))
public class User extends BaseEntity {

    @Column(nullable = false, length = 64)
    private String username;

    @Column(nullable = false, length = 128)
    private String password;

    @Column(length = 128)
    private String email;

    @Column(length = 32)
    private String phone;

    @Column(length = 128)
    private String nickname;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role = Role.USER;

    /** 账户余额，用于 BALANCE 支付方式 */
    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal balance = new BigDecimal("10000.00");

    @Column(nullable = false)
    private Boolean enabled = Boolean.TRUE;
}
