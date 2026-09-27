package com.demo.shop.config.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.util.Date;
import java.util.Map;

@Component
public class JwtTokenProvider {

    private final Key key;
    private final long accessTtlMs;
    private final long refreshTtlMs;

    public JwtTokenProvider(@Value("${shop.jwt.secret}") String secret,
                            @Value("${shop.jwt.access-token-ttl-ms}") long accessTtlMs,
                            @Value("${shop.jwt.refresh-token-ttl-ms}") long refreshTtlMs) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtlMs = accessTtlMs;
        this.refreshTtlMs = refreshTtlMs;
    }

    public String createAccessToken(String username, String role, Long userId) {
        return createToken(username, Map.of("role", role, "uid", userId), accessTtlMs, "access");
    }

    public String createRefreshToken(String username, Long userId) {
        return createToken(username, Map.of("uid", userId), refreshTtlMs, "refresh");
    }

    private String createToken(String subject, Map<String, Object> claims, long ttl, String type) {
        Date now = new Date();
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(subject)
                .claim("typ", type)
                .setIssuedAt(now)
                .setExpiration(new Date(now.getTime() + ttl))
                .signWith(key, SignatureAlgorithm.HS256)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parserBuilder().setSigningKey(key).build().parseClaimsJws(token).getBody();
    }

    public boolean isValid(String token) {
        try {
            parse(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public long getAccessTtlMs() {
        return accessTtlMs;
    }
}
