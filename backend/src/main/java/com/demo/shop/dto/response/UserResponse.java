package com.demo.shop.dto.response;

import com.demo.shop.common.enums.Role;
import com.demo.shop.entity.User;

import java.math.BigDecimal;

public record UserResponse(Long id, String username, String nickname, String email, Role role, BigDecimal balance) {
    public static UserResponse from(User u) {
        return new UserResponse(u.getId(), u.getUsername(), u.getNickname(), u.getEmail(), u.getRole(), u.getBalance());
    }
}
