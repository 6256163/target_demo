package com.demo.shop.common;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.Data;

import java.time.Instant;

/**
 * 统一响应体。code=0 表示成功，其余为业务/系统错误。
 * traceId 用于压测时串联日志。
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

    public static final int OK = 0;

    private int code;
    private String message;
    private T data;
    private String traceId;
    private String timestamp = Instant.now().toString();

    public static <T> ApiResponse<T> ok(T data) {
        ApiResponse<T> r = new ApiResponse<>();
        r.setCode(OK);
        r.setMessage("success");
        r.setData(data);
        return r;
    }

    public static <T> ApiResponse<T> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> fail(ErrorCode errorCode, String message) {
        ApiResponse<T> r = new ApiResponse<>();
        r.setCode(errorCode.getCode());
        r.setMessage(message == null ? errorCode.getMessage() : message);
        return r;
    }
}
