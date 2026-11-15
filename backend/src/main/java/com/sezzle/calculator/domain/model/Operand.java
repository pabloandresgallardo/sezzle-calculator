package com.sezzle.calculator.domain.model;

import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import java.math.BigDecimal;

public record Operand(BigDecimal value) {

    private static final int MAX_INTEGER_DIGITS = 15;
    private static final int MAX_SIGNIFICANT_DIGITS = 15;
    private static final int MAX_DECIMAL_PLACES = 10;

    public Operand {
        // Magnitude first: it is cheap even for huge exponents (no expansion).
        if (value.signum() != 0 && (long) value.precision() - value.scale() > MAX_INTEGER_DIGITS) {
            throw new OperandOutOfRangeException("absolute value must be less than 10^15");
        }
        BigDecimal normalized = value.stripTrailingZeros();
        if (normalized.precision() > MAX_SIGNIFICANT_DIGITS) {
            throw new OperandOutOfRangeException("has more than 15 significant digits");
        }
        if (normalized.scale() > MAX_DECIMAL_PLACES) {
            throw new OperandOutOfRangeException("has more than 10 decimal places");
        }
        // Store the normalized value: a zero like 0E-999999999 keeps its raw scale otherwise, and aligning
        // scales in add/subtract/divide would expand 10^999999999 (unbounded CPU / BigInteger overflow).
        value = normalized;
    }
}
