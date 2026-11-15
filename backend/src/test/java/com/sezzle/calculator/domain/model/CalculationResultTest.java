package com.sezzle.calculator.domain.model;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class CalculationResultTest {

    @Test
    void formatsWithoutScientificNotation() {
        assertThat(new CalculationResult(Operation.MULTIPLY, new BigDecimal("1E+30")).formatted())
                .isEqualTo("1000000000000000000000000000000");
    }

    @Test
    void formatsZeroWithoutTrailingZeros() {
        assertThat(new CalculationResult(Operation.ADD, new BigDecimal("0.000")).formatted())
                .isEqualTo("0");
    }
}
