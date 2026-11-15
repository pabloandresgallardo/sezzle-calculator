package com.sezzle.calculator.domain.exception;

import com.sezzle.calculator.domain.model.Operation;

public class InvalidOperandCountException extends CalculationException {

    public InvalidOperandCountException(Operation operation, int expected, int actual) {
        super(operation.code() + " requires " + expected + " operands, got " + actual);
    }
}
