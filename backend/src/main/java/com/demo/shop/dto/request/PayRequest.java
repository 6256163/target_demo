package com.demo.shop.dto.request;

import com.demo.shop.common.enums.PayType;
import com.demo.shop.common.enums.PaymentOutcome;
import jakarta.validation.constraints.NotBlank;

public record PayRequest(
        @NotBlank String orderNo,
        PayType payType,
        /** 强制指定 mock 结果，不传则按配置的失败率/超时率随机 */
        PaymentOutcome outcome,
        /** 幂等键，重复请求同一 key 返回同一支付单 */
        String idempotencyKey
) {
}
