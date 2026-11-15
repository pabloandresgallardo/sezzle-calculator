package com.sezzle.calculator.domain.exception;

public abstract class CalculationException extends RuntimeException {

    protected CalculationException(String message) {
        super(message);
    }
}
