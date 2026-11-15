package com.sezzle.calculator.domain.exception;

public class InvalidOperandException extends CalculationException {

    public InvalidOperandException(int index, String reason) {
        super("operands[" + index + "] " + reason);
    }
}
