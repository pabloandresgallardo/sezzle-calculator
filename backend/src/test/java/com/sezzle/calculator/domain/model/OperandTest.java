package com.sezzle.calculator.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class OperandTest {

    @ParameterizedTest
    @ValueSource(
            strings = {
                "0",
                "-0",
                "999999999999999",
                "-999999999999999",
                "0.0000000001",
                "12345.6789012345",
                "1.50000000000000000",
                "1E+14"
            })
    void acceptsValuesWithinLimits(String literal) {
        assertThatCode(() -> new Operand(new BigDecimal(literal))).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @CsvSource({
        "1000000000000000, absolute value must be less than 10^15",
        "1E+999999999, absolute value must be less than 10^15",
        "-1000000000000000, absolute value must be less than 10^15",
        "1234567890.12345678, has more than 15 significant digits",
        "0.12345678901, has more than 10 decimal places",
        "1E-999999999, has more than 10 decimal places"
    })
    void rejectsValuesOutOfRange(String literal, String reason) {
        assertThatThrownBy(() -> new Operand(new BigDecimal(literal)))
                .isInstanceOf(OperandOutOfRangeException.class)
                .hasMessage(reason);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0E-999999999", "0E+999999999", "-0.000"})
    void storesZeroWithHugeExponentNormalized(String literal) {
        Operand operand = new Operand(new BigDecimal(literal));

        assertThat(operand.value().scale()).isZero();
        assertThat(operand.value()).isEqualByComparingTo(BigDecimal.ZERO);
    }

    @Test
    void storesNonZeroWithoutTrailingZeros() {
        Operand operand = new Operand(new BigDecimal("1.500"));

        assertThat(operand.value().scale()).isEqualTo(1);
        assertThat(operand.value()).isEqualByComparingTo("1.5");
    }

    @Test
    void withIndexPrefixesMessage() {
        OperandOutOfRangeException ex = catchOutOfRange("0.12345678901");

        assertThat(ex.withIndex(1)).hasMessage("operands[1] has more than 10 decimal places");
    }

    private static OperandOutOfRangeException catchOutOfRange(String literal) {
        try {
            new Operand(new BigDecimal(literal));
        } catch (OperandOutOfRangeException e) {
            return e;
        }
        throw new AssertionError("expected OperandOutOfRangeException");
    }
}
