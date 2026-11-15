package com.sezzle.calculator.application.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sezzle.calculator.application.port.in.CalculateCommand;
import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.InvalidOperandCountException;
import com.sezzle.calculator.domain.exception.InvalidOperandException;
import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class CalculatorServiceTest {

    private final CalculatorService service = new CalculatorService();

    @Test
    void addsWithoutFloatingPointError() {
        var result =
                service.calculate(new CalculateCommand("add", List.of(new BigDecimal("0.1"), new BigDecimal("0.2"))));
        assertThat(result.formatted()).isEqualTo("0.3");
    }

    @Test
    void rejectsUnsupportedOperation() {
        var command = new CalculateCommand("modulo", List.of(BigDecimal.ONE, BigDecimal.TWO, BigDecimal.TEN));
        assertThatThrownBy(() -> service.calculate(command)).isInstanceOf(UnsupportedCalculationException.class);
    }

    @Test
    void rejectsTooManyOperands() {
        var command = new CalculateCommand("add", List.of(BigDecimal.ONE, BigDecimal.TWO, BigDecimal.TEN));
        assertThatThrownBy(() -> service.calculate(command))
                .isInstanceOf(InvalidOperandCountException.class)
                .hasMessage("add requires 2 operands, got 3");
    }

    @Test
    void rejectsTooFewOperands() {
        var command = new CalculateCommand("add", List.of(BigDecimal.ONE));
        assertThatThrownBy(() -> service.calculate(command)).isInstanceOf(InvalidOperandCountException.class);
    }

    @Test
    void reportsIndexOfHugeOperand() {
        var command = new CalculateCommand("divide", List.of(new BigDecimal("1E+999999999"), BigDecimal.ZERO));
        assertThatThrownBy(() -> service.calculate(command))
                .isInstanceOf(OperandOutOfRangeException.class)
                .hasMessageStartingWith("operands[0] ");
    }

    @Test
    void reportsIndexOfTooPreciseOperand() {
        var command = new CalculateCommand("add", List.of(BigDecimal.ONE, new BigDecimal("0.12345678901")));
        assertThatThrownBy(() -> service.calculate(command))
                .isInstanceOf(OperandOutOfRangeException.class)
                .hasMessageStartingWith("operands[1] ");
    }

    @Test
    void rejectsDivisionByZero() {
        var command = new CalculateCommand("divide", List.of(new BigDecimal("5"), BigDecimal.ZERO));
        assertThatThrownBy(() -> service.calculate(command)).isInstanceOf(DivisionByZeroException.class);
    }

    @Test
    void computesSqrt() {
        var result = service.calculate(new CalculateCommand("sqrt", List.of(new BigDecimal("16"))));
        assertThat(result.formatted()).isEqualTo("4");
    }

    @Test
    void rejectsSqrtWithTwoOperands() {
        var command = new CalculateCommand("sqrt", List.of(BigDecimal.ONE, BigDecimal.TWO));
        assertThatThrownBy(() -> service.calculate(command))
                .isInstanceOf(InvalidOperandCountException.class)
                .hasMessage("sqrt requires 1 operand, got 2");
    }

    @Test
    void genericBoundsRunBeforeOperationValidation() {
        var command = new CalculateCommand("sqrt", List.of(new BigDecimal("1E+999999999")));
        assertThatThrownBy(() -> service.calculate(command))
                .isInstanceOf(OperandOutOfRangeException.class)
                .hasMessageStartingWith("operands[0] ");
    }

    @Test
    void rejectsNonIntegerExponent() {
        var command = new CalculateCommand("power", List.of(new BigDecimal("2"), new BigDecimal("1000.5")));
        assertThatThrownBy(() -> service.calculate(command)).isInstanceOf(InvalidOperandException.class);
    }
}
