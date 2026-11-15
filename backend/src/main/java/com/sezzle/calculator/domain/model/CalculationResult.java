package com.sezzle.calculator.domain.model;

import java.math.BigDecimal;

public record CalculationResult(Operation operation, BigDecimal value) {

    public String formatted() {
        return value.stripTrailingZeros().toPlainString();
    }
}
