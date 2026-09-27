package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.common.enums.PaymentStatus;
import com.demo.shop.config.security.CurrentUser;
import com.demo.shop.dto.request.PayRequest;
import com.demo.shop.dto.response.PaymentResponse;
import com.demo.shop.service.PaymentService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/payments")
@RequiredArgsConstructor
public class PaymentController {

    private final PaymentService paymentService;

    @Operation(summary = "发起支付（mock 网关）")
    @PostMapping
    public ApiResponse<PaymentResponse> pay(@RequestBody PayRequest req) {
        return ApiResponse.ok(paymentService.pay(CurrentUser.id(), req));
    }

    @Operation(summary = "查询支付单")
    @GetMapping("/{tradeNo}")
    public ApiResponse<PaymentResponse> detail(@PathVariable String tradeNo) {
        return ApiResponse.ok(paymentService.get(tradeNo));
    }

    @GetMapping
    public ApiResponse<List<PaymentResponse>> list(@RequestParam String orderNo) {
        return ApiResponse.ok(paymentService.listByOrder(orderNo));
    }

    @Operation(summary = "模拟第三方支付结果回调（幂等）")
    @PostMapping("/{tradeNo}/callback")
    public ApiResponse<PaymentResponse> callback(@PathVariable String tradeNo,
                                                 @RequestParam PaymentStatus status,
                                                 @RequestParam(required = false) String callbackId) {
        return ApiResponse.ok(paymentService.callback(tradeNo, status, callbackId));
    }

    @Operation(summary = "退款")
    @PostMapping("/{tradeNo}/refund")
    public ApiResponse<PaymentResponse> refund(@PathVariable String tradeNo) {
        return ApiResponse.ok(paymentService.refund(tradeNo));
    }
}
