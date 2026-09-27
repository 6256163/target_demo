package com.demo.shop.dto.response;

public record LoginResponse(
        String accessToken,
        String refreshToken,
        String tokenType,
        Long expiresIn,
        Long userId,
        String username,
        String role
) {
    public static LoginResponse of(String access, String refresh, long ttlMs, Long userId, String username, String role) {
        return new LoginResponse(access, refresh, "Bearer", ttlMs / 1000, userId, username, role);
    }
}
