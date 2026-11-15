package com.sezzle.calculator.domain.exception;

public class UnsupportedCalculationException extends CalculationException {

    private static final int MAX_ECHOED_CODE_LENGTH = 32;

    public UnsupportedCalculationException(String code) {
        super("unsupported operation: " + truncate(code));
    }

    private static String truncate(String code) {
        if (code == null || code.length() <= MAX_ECHOED_CODE_LENGTH) {
            return code;
        }
        return code.substring(0, MAX_ECHOED_CODE_LENGTH) + "\u2026";
    }
}
