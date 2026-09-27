package com.demo.shop.dto.response;

import com.demo.shop.entity.PaymentConfig;

public record PaymentConfigResponse(
        Double failureRate,
        Double timeoutRate,
        Integer minDelayMs,
        Integer maxDelayMs,
        Boolean asyncEnabled
) {
    public static PaymentConfigResponse from(PaymentConfig c) {
        return new PaymentConfigResponse(c.getFailureRate(), c.getTimeoutRate(),
                c.getMinDelayMs(), c.getMaxDelayMs(), c.getAsyncEnabled());
    }
}
