package com.demo.shop.service;

import com.demo.shop.common.BizException;
import com.demo.shop.common.ErrorCode;
import com.demo.shop.common.enums.Role;
import com.demo.shop.config.security.CurrentUser;
import com.demo.shop.config.security.JwtTokenProvider;
import com.demo.shop.dto.request.LoginRequest;
import com.demo.shop.dto.request.RegisterRequest;
import com.demo.shop.dto.response.LoginResponse;
import com.demo.shop.dto.response.UserResponse;
import com.demo.shop.entity.User;
import com.demo.shop.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    @Transactional
    public UserResponse register(RegisterRequest req) {
        if (userRepository.existsByUsername(req.username())) {
            throw new BizException(ErrorCode.USER_EXISTS);
        }
        User user = new User();
        user.setUsername(req.username());
        user.setPassword(passwordEncoder.encode(req.password()));
        user.setEmail(req.email());
        user.setNickname(req.nickname() == null ? req.username() : req.nickname());
        user.setRole(Role.USER);
        user.setBalance(new BigDecimal("10000.00"));
        userRepository.save(user);
        return UserResponse.from(user);
    }

    public LoginResponse login(LoginRequest req) {
        User user = userRepository.findByUsername(req.username())
                .orElseThrow(() -> new BizException(ErrorCode.INVALID_CREDENTIALS));
        if (!passwordEncoder.matches(req.password(), user.getPassword())) {
            throw new BizException(ErrorCode.INVALID_CREDENTIALS);
        }
        if (!Boolean.TRUE.equals(user.getEnabled())) {
            throw new BizException(ErrorCode.FORBIDDEN, "账号已被禁用");
        }
        String access = jwtTokenProvider.createAccessToken(user.getUsername(), user.getRole().name(), user.getId());
        String refresh = jwtTokenProvider.createRefreshToken(user.getUsername(), user.getId());
        return LoginResponse.of(access, refresh, jwtTokenProvider.getAccessTtlMs(),
                user.getId(), user.getUsername(), user.getRole().name());
    }

    public LoginResponse refresh(String refreshToken) {
        try {
            var claims = jwtTokenProvider.parse(refreshToken);
            String username = claims.getSubject();
            User user = userRepository.findByUsername(username)
                    .orElseThrow(() -> new BizException(ErrorCode.UNAUTHORIZED));
            String access = jwtTokenProvider.createAccessToken(username, user.getRole().name(), user.getId());
            String refreshed = jwtTokenProvider.createRefreshToken(username, user.getId());
            return LoginResponse.of(access, refreshed, jwtTokenProvider.getAccessTtlMs(),
                    user.getId(), username, user.getRole().name());
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "refresh token 无效或已过期");
        }
    }

    public UserResponse me() {
        Long userId = CurrentUser.id();
        User user = userRepository.findById(userId).orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND));
        return UserResponse.from(user);
    }
}
