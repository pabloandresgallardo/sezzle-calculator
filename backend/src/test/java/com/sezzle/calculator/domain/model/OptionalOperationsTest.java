package com.sezzle.calculator.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.InvalidOperandException;
import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import com.sezzle.calculator.domain.exception.ResultOutOfRangeException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;

class OptionalOperationsTest {

    /** Same order as the service: validate first, then apply. */
    private static String run(Operation operation, String... literals) {
        List<Operand> operands = Arrays.stream(literals)
                .map(literal -> new Operand(new BigDecimal(literal)))
                .toList();
        operation.validate(operands);
        return new CalculationResult(operation, operation.apply(operands)).formatted();
    }

    @ParameterizedTest(name = "sqrt {0} = {1}")
    @CsvSource({
        "2, 1.4142135624",
        "16, 4",
        "0.25, 0.5",
        "3, 1.7320508076",
        "0.0000000001, 0.00001",
        "999999999999999, 31622776.6016837775",
        "0, 0"
    })
    void sqrtExamples(String operand, String expected) {
        assertThat(run(Operation.SQRT, operand)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "power {0} {1} = {2}")
    @MethodSource("powerRows")
    void powerExamples(String base, String exponent, String expected) {
        assertThat(run(Operation.POWER, base, exponent)).isEqualTo(expected);
    }

    static Stream<Arguments> powerRows() {
        return Stream.of(
                Arguments.of("2", "64", "18446744073709551616"),
                Arguments.of("2", "-3", "0.125"),
                Arguments.of("3", "-5", "0.0041152263"),
                Arguments.of("1.5", "3", "3.375"),
                Arguments.of("0.5", "10", "0.0009765625"),
                Arguments.of("0.1234567891", "3", "0.0018816764"),
                Arguments.of("-2", "3", "-8"),
                Arguments.of("0", "0", "1"),
                Arguments.of("10", "99", "1" + "0".repeat(99)));
    }

    @ParameterizedTest(name = "percentage {0} {1} = {2}")
    @CsvSource({"20, 150, 30", "12.5, 80, 10", "0.1, 0.1, 0.0001", "-15, 200, -30"})
    void percentageExamples(String left, String right, String expected) {
        assertThat(run(Operation.PERCENTAGE, left, right)).isEqualTo(expected);
    }

    @Test
    void sqrtOfNegativeIsInvalidOperand() {
        assertThatThrownBy(() -> run(Operation.SQRT, "-4"))
                .isInstanceOf(InvalidOperandException.class)
                .hasMessage("operands[0] must not be negative");
    }

    @ParameterizedTest(name = "power 2 {0} -> must be an integer")
    @CsvSource({"0.5", "1000.5"})
    void nonIntegerExponentIsInvalidOperand(String exponent) {
        assertThatThrownBy(() -> run(Operation.POWER, "2", exponent))
                .isInstanceOf(InvalidOperandException.class)
                .hasMessage("operands[1] must be an integer");
    }

    @ParameterizedTest(name = "power 2 {0} -> exponent out of range")
    @CsvSource({"1001", "-1001"})
    void exponentOutOfRange(String exponent) {
        assertThatThrownBy(() -> run(Operation.POWER, "2", exponent))
                .isInstanceOf(OperandOutOfRangeException.class)
                .hasMessage("operands[1] must be between -1000 and 1000");
    }

    @Test
    void powerWithMoreThan100IntegerDigitsIsOutOfRange() {
        assertThatThrownBy(() -> run(Operation.POWER, "10", "100"))
                .isInstanceOf(ResultOutOfRangeException.class)
                .hasMessage("result would exceed 100 integer digits");
    }

    @Test
    void zeroToNegativePowerIsDivisionByZero() {
        assertThatThrownBy(() -> run(Operation.POWER, "0", "-1")).isInstanceOf(DivisionByZeroException.class);
    }

    @Timeout(value = 2, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
    @ParameterizedTest(name = "power {0} {1} rejected without computing")
    @CsvSource({"999999999999999, 1000", "0.5, -1000"})
    void hugePowerIsRejectedWithoutComputing(String base, String exponent) {
        assertThatThrownBy(() -> run(Operation.POWER, base, exponent)).isInstanceOf(ResultOutOfRangeException.class);
    }

    @Timeout(value = 2, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
    @Test
    void tinyPowerRoundsToZeroWithoutComputing() {
        assertThat(run(Operation.POWER, "3", "-1000")).isEqualTo("0");
    }

    @Test
    void arity() {
        assertThat(Operation.SQRT.arity()).isEqualTo(1);
        for (Operation operation : Operation.values()) {
            if (operation != Operation.SQRT) {
                assertThat(operation.arity()).as(operation.code()).isEqualTo(2);
            }
        }
    }

    @Test
    void codesAreExactLowercase() {
        assertThat(Operation.fromCode("power")).isEqualTo(Operation.POWER);
        assertThat(Operation.fromCode("sqrt")).isEqualTo(Operation.SQRT);
        assertThat(Operation.fromCode("percentage")).isEqualTo(Operation.PERCENTAGE);
        assertThatThrownBy(() -> Operation.fromCode("PERCENTAGE")).isInstanceOf(UnsupportedCalculationException.class);
    }

    @Test
    void validateIsNoOpForBinaryArithmetic() {
        List<Operand> operands = List.of(new Operand(BigDecimal.ONE), new Operand(BigDecimal.ZERO));
        for (Operation operation : List.of(Operation.ADD, Operation.SUBTRACT, Operation.MULTIPLY, Operation.DIVIDE)) {
            operation.validate(operands);
        }
        Operation.PERCENTAGE.validate(operands);
    }

    @Test
    void powerValidateRejectsHugeResultsWithoutApplying() {
        for (String[] pair : new String[][] {{"999999999999999", "1000"}, {"0.5", "-1000"}}) {
            List<Operand> operands =
                    List.of(new Operand(new BigDecimal(pair[0])), new Operand(new BigDecimal(pair[1])));
            assertThatThrownBy(() -> Operation.POWER.validate(operands)).isInstanceOf(ResultOutOfRangeException.class);
        }
    }
}
