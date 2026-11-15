package com.sezzle.calculator.domain.exception;

public class ResultOutOfRangeException extends CalculationException {

    public ResultOutOfRangeException() {
        super("result would exceed 100 integer digits");
    }
}
