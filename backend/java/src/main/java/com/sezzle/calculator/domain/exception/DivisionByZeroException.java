package com.sezzle.calculator.domain.exception;

public class DivisionByZeroException extends CalculationException {

    public DivisionByZeroException() {
        super("division by zero");
    }
}
