package com.demo.shop.common.enums;

/** 支付 mock 的强制结果，用于自动化测试构造确定性场景；不传则按配置的失败率随机 */
public enum PaymentOutcome {
    SUCCESS, FAILED, TIMEOUT, RANDOM
}
