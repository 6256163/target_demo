package com.demo.shop.dto.request;

import jakarta.validation.constraints.NotNull;

public record StockAdjustRequest(@NotNull Integer delta) {
}
