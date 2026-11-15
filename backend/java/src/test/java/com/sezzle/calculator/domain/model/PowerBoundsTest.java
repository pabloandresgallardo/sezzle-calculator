package com.sezzle.calculator.domain.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sezzle.calculator.domain.exception.ResultOutOfRangeException;
import com.sezzle.calculator.domain.model.PowerBounds.Estimate;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class PowerBoundsTest {

    @ParameterizedTest(name = "estimate({0}, {1}) = {2}")
    @CsvSource({
        "999999999999999, 1000, TOO_LARGE",
        "0.5, -1000, TOO_LARGE",
        "3, -1000, ROUNDS_TO_ZERO",
        "10, 99, COMPUTE",
        "0, -1, COMPUTE",
        "1, 1000, COMPUTE",
        "-1, 999, COMPUTE"
    })
    void estimates(String base, int exponent, Estimate expected) {
        assertThat(PowerBounds.estimate(new BigDecimal(base), exponent)).isEqualTo(expected);
    }

    @Test
    void acceptsExactlyOneHundredIntegerDigits() {
        assertThatCode(() -> PowerBounds.requireWithinIntegerDigits(BigDecimal.TEN.pow(99)))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsMoreThanOneHundredIntegerDigits() {
        assertThatThrownBy(() -> PowerBounds.requireWithinIntegerDigits(BigDecimal.TEN.pow(100)))
                .isInstanceOf(ResultOutOfRangeException.class)
                .hasMessage("result would exceed 100 integer digits");
    }
}
