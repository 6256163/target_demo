package com.demo.shop.common;

import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ResponseEntity<ApiResponse<Void>> handleBiz(BizException e, HttpServletRequest request) {
        ApiResponse<Void> body = ApiResponse.fail(e.getErrorCode(), e.getMessage());
        body.setTraceId(newTraceId());
        return ResponseEntity.status(e.getErrorCode().httpStatus()).body(body);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(err -> ((FieldError) err).getField() + ":" + err.getDefaultMessage())
                .collect(Collectors.joining(", "));
        ApiResponse<Void> body = ApiResponse.fail(ErrorCode.BAD_REQUEST, msg);
        body.setTraceId(newTraceId());
        return ResponseEntity.badRequest().body(body);
    }

    /**
     * 乐观锁冲突兜底：即便业务代码已经用 saveAndFlush 在重试循环内消化了大部分冲突，
     * 仍可能有在事务提交阶段才暴露的冲突漏到这里。统一映射成 409 CONFLICT，
     * 而不是 500 —— 压测时「冲突」是正常现象，用 500 会污染错误率和告警。
     */
    @ExceptionHandler({org.springframework.dao.OptimisticLockingFailureException.class,
            org.springframework.transaction.UnexpectedRollbackException.class})
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLock(Exception e) {
        ApiResponse<Void> body = ApiResponse.fail(ErrorCode.CONFLICT, "库存并发冲突，请重试");
        body.setTraceId(newTraceId());
        return ResponseEntity.status(ErrorCode.CONFLICT.httpStatus()).body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception e, HttpServletRequest request) {
        log.error("unexpected error on {} {}", request.getMethod(), request.getRequestURI(), e);
        ApiResponse<Void> body = ApiResponse.fail(ErrorCode.INTERNAL_ERROR, e.getMessage());
        body.setTraceId(newTraceId());
        return ResponseEntity.internalServerError().body(body);
    }

    private String newTraceId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }
}
