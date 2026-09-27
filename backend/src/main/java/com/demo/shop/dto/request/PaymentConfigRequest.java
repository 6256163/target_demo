package com.demo.shop.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Data;

@Data
public class PaymentConfigRequest {

    @Min(0) @Max(1)
    private Double failureRate;
    @Min(0) @Max(1)
    private Double timeoutRate;
    @Min(0)
    private Integer minDelayMs;
    @Min(0)
    private Integer maxDelayMs;
    private Boolean asyncEnabled;
}
