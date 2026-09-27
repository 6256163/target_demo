package com.demo.shop.controller;

import com.demo.shop.common.ApiResponse;
import com.demo.shop.dto.request.PaymentConfigRequest;
import com.demo.shop.dto.response.PaymentConfigResponse;
import com.demo.shop.service.PaymentService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/payment")
@RequiredArgsConstructor
public class AdminPaymentController {

    private final PaymentService paymentService;

    @GetMapping("/config")
    public ApiResponse<PaymentConfigResponse> getConfig() {
        return ApiResponse.ok(paymentService.getConfig());
    }

    @PutMapping("/config")
    public ApiResponse<PaymentConfigResponse> updateConfig(@RequestBody PaymentConfigRequest req) {
        return ApiResponse.ok(paymentService.updateConfig(req));
    }
}
