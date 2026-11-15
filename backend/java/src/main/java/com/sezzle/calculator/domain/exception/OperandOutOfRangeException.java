package com.sezzle.calculator.domain.exception;

public class OperandOutOfRangeException extends CalculationException {

    private final String reason;

    public OperandOutOfRangeException(String reason) {
        super(reason);
        this.reason = reason;
    }

    public OperandOutOfRangeException withIndex(int index) {
        return new OperandOutOfRangeException("operands[" + index + "] " + reason);
    }
}
