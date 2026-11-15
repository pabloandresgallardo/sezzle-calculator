package com.sezzle.calculator.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class OperationTest {

    private static Operand op(String literal) {
        return new Operand(new BigDecimal(literal));
    }

    @ParameterizedTest
    @CsvSource({
        "ADD, 0.1, 0.2, 0.3",
        "SUBTRACT, 5, 8, -3",
        "MULTIPLY, 999999999999999, 999999999999999, 999999999999998000000000000001",
        "MULTIPLY, -2.5, 0, 0",
        "DIVIDE, 6, 3, 2",
        "DIVIDE, 1, 3, 0.3333333333",
        "DIVIDE, 2, 3, 0.6666666667",
        "DIVIDE, 1, 8, 0.125",
        "DIVIDE, 0.0000000001, 3, 0",
        "DIVIDE, 1, 2048, 0.0004882812"
    })
    void appliesOperation(Operation operation, String left, String right, String expected) {
        BigDecimal value = operation.apply(op(left), op(right));

        assertThat(new CalculationResult(operation, value).formatted()).isEqualTo(expected);
    }

    @Timeout(value = 2, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
    @ParameterizedTest
    @CsvSource({
        "ADD, 0E-999999999, 1, 1",
        "ADD, 0E-999999, 1, 1",
        "SUBTRACT, 0E-999999999, 1, -1",
        "MULTIPLY, 0E-999999999, 1, 0",
        "DIVIDE, 0E-999999999, 1, 0",
        "ADD, 0E+999999999, 1, 1",
        "SUBTRACT, 1, 0E+999999999, 1"
    })
    void zeroWithHugeExponentCompletesFast(Operation operation, String left, String right, String expected) {
        BigDecimal value = operation.apply(op(left), op(right));

        assertThat(new CalculationResult(operation, value).formatted()).isEqualTo(expected);
    }

    @Test
    void divisionByZeroThrows() {
        assertThatThrownBy(() -> Operation.DIVIDE.apply(op("5"), op("0"))).isInstanceOf(DivisionByZeroException.class);
    }

    @Test
    void codesAndArity() {
        assertThat(Operation.ADD.code()).isEqualTo("add");
        assertThat(Operation.SUBTRACT.code()).isEqualTo("subtract");
        assertThat(Operation.MULTIPLY.code()).isEqualTo("multiply");
        assertThat(Operation.DIVIDE.code()).isEqualTo("divide");
        for (Operation operation : Operation.values()) {
            assertThat(operation.arity()).isEqualTo(2);
        }
    }

    @Test
    void fromCodeResolvesExactLowercase() {
        assertThat(Operation.fromCode("add")).isEqualTo(Operation.ADD);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ADD", "power"})
    @NullAndEmptySource
    void fromCodeRejectsUnknown(String code) {
        assertThatThrownBy(() -> Operation.fromCode(code)).isInstanceOf(UnsupportedCalculationException.class);
    }

    @Test
    void unsupportedMessageEchoesShortCodes() {
        String code = "p".repeat(32);

        assertThatThrownBy(() -> Operation.fromCode(code)).hasMessage("unsupported operation: " + code);
    }

    @Test
    void unsupportedMessageTruncatesLongCodes() {
        String code = "p".repeat(100);

        assertThatThrownBy(() -> Operation.fromCode(code))
                .hasMessage("unsupported operation: " + "p".repeat(32) + "\u2026");
    }
}
