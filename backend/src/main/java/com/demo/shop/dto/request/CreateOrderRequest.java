package com.demo.shop.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class CreateOrderRequest {

    /** 直接下单（不走购物车）：必填 */
    @Valid
    private List<OrderItemReq> items;

    private String receiverName;
    private String receiverPhone;
    private String receiverAddress;
    private String remark;

    /** true 表示用购物车内的全部商品下单 */
    private Boolean fromCart = Boolean.FALSE;

    @Data
    public static class OrderItemReq {
        @NotNull
        private Long productId;
        @NotNull @Min(1)
        private Integer quantity;
    }
}
