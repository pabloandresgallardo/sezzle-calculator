package com.sezzle.calculator.adapter.in.web;

import com.sezzle.calculator.domain.exception.CalculationException;
import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.InvalidOperandCountException;
import com.sezzle.calculator.domain.exception.InvalidOperandException;
import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import com.sezzle.calculator.domain.exception.ResultOutOfRangeException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Maps parsing, validation and domain errors to RFC 9457 problem details. Titles are part of the API contract.
 */
@Slf4j
@RestControllerAdvice
public class ProblemDetailHandler extends ResponseEntityExceptionHandler {

    static final String MALFORMED_REQUEST = "Malformed request";
    static final String DIVISION_BY_ZERO = "Division by zero";
    static final String UNSUPPORTED_OPERATION = "Unsupported operation";
    static final String INVALID_OPERAND_COUNT = "Invalid operand count";
    static final String OPERAND_OUT_OF_RANGE = "Operand out of range";
    static final String INVALID_OPERAND = "Invalid operand";
    static final String RESULT_OUT_OF_RANGE = "Result out of range";
    static final String INTERNAL_ERROR = "Internal error";

    private static final String NOT_READABLE_DETAIL =
            "Request body is not valid JSON or does not match the expected shape";
    private static final String INTERNAL_ERROR_DETAIL = "An unexpected error occurred";

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        return malformed(ex, NOT_READABLE_DETAIL, headers, request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        String detail = ex.getBindingResult().getFieldErrors().stream()
                .map(ProblemDetailHandler::describe)
                .sorted()
                .collect(Collectors.joining("; "));
        return malformed(ex, detail, headers, request);
    }

    /** Locale-independent: the default message is resolved with the request's Accept-Language. */
    static String describe(FieldError error) {
        String reason = "NotNull".equals(error.getCode()) ? "must not be null" : "is invalid";
        return error.getField() + " " + reason;
    }

    @ExceptionHandler(DivisionByZeroException.class)
    ProblemDetail handleDivisionByZero(DivisionByZeroException ex) {
        return badRequest(DIVISION_BY_ZERO, ex);
    }

    @ExceptionHandler(UnsupportedCalculationException.class)
    ProblemDetail handleUnsupportedOperation(UnsupportedCalculationException ex) {
        return badRequest(UNSUPPORTED_OPERATION, ex);
    }

    @ExceptionHandler(InvalidOperandCountException.class)
    ProblemDetail handleInvalidOperandCount(InvalidOperandCountException ex) {
        return badRequest(INVALID_OPERAND_COUNT, ex);
    }

    @ExceptionHandler(OperandOutOfRangeException.class)
    ProblemDetail handleOperandOutOfRange(OperandOutOfRangeException ex) {
        return badRequest(OPERAND_OUT_OF_RANGE, ex);
    }

    @ExceptionHandler(InvalidOperandException.class)
    ProblemDetail handleInvalidOperand(InvalidOperandException ex) {
        return badRequest(INVALID_OPERAND, ex);
    }

    @ExceptionHandler(ResultOutOfRangeException.class)
    ProblemDetail handleResultOutOfRange(ResultOutOfRangeException ex) {
        return badRequest(RESULT_OUT_OF_RANGE, ex);
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail handleUnexpected(Exception ex) {
        log.error("Unexpected error while handling request", ex);
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, INTERNAL_ERROR, INTERNAL_ERROR_DETAIL);
    }

    private ResponseEntity<Object> malformed(Exception ex, String detail, HttpHeaders headers, WebRequest request) {
        ProblemDetail body = problem(HttpStatus.BAD_REQUEST, MALFORMED_REQUEST, detail);
        return handleExceptionInternal(ex, body, headers, HttpStatus.BAD_REQUEST, request);
    }

    private static ProblemDetail badRequest(String title, CalculationException ex) {
        return problem(HttpStatus.BAD_REQUEST, title, ex.getMessage());
    }

    private static ProblemDetail problem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        return problem;
    }
}
