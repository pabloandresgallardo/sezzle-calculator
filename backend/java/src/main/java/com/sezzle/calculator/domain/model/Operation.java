package com.sezzle.calculator.domain.model;

import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.InvalidOperandException;
import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import com.sezzle.calculator.domain.exception.ResultOutOfRangeException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.List;

/**
 * Each constant is a strategy over its operands. Callers check {@link #arity()}, then call {@link #validate(List)}
 * and finally {@link #apply(List)}.
 */
public enum Operation {
    ADD("add") {
        @Override
        public BigDecimal apply(List<Operand> operands) {
            return left(operands).add(right(operands));
        }
    },
    SUBTRACT("subtract") {
        @Override
        public BigDecimal apply(List<Operand> operands) {
            return left(operands).subtract(right(operands));
        }
    },
    MULTIPLY("multiply") {
        @Override
        public BigDecimal apply(List<Operand> operands) {
            return left(operands).multiply(right(operands));
        }
    },
    DIVIDE("divide") {
        @Override
        public BigDecimal apply(List<Operand> operands) {
            BigDecimal divisor = right(operands);
            if (divisor.signum() == 0) {
                throw new DivisionByZeroException();
            }
            return left(operands).divide(divisor, RESULT_SCALE, RoundingMode.HALF_EVEN);
        }
    },
    POWER("power") {
        @Override
        public void validate(List<Operand> operands) {
            BigDecimal exponent = right(operands);
            // Operand stores normalized values, so an integer has a non-positive scale.
            if (exponent.scale() > 0) {
                throw new InvalidOperandException(1, "must be an integer");
            }
            if (exponent.compareTo(MIN_EXPONENT) < 0 || exponent.compareTo(MAX_EXPONENT) > 0) {
                throw new OperandOutOfRangeException("must be between -1000 and 1000").withIndex(1);
            }
            if (PowerBounds.estimate(left(operands), exponent.intValueExact()) == PowerBounds.Estimate.TOO_LARGE) {
                throw new ResultOutOfRangeException();
            }
        }

        @Override
        public BigDecimal apply(List<Operand> operands) {
            // Re-validating keeps apply safe on its own: the cost bound must never be skipped.
            validate(operands);
            BigDecimal base = left(operands);
            int exponent = right(operands).intValueExact();
            if (PowerBounds.estimate(base, exponent) == PowerBounds.Estimate.ROUNDS_TO_ZERO) {
                return BigDecimal.ZERO;
            }
            BigDecimal result;
            if (exponent >= 0) {
                result = base.pow(exponent).setScale(RESULT_SCALE, RoundingMode.HALF_EVEN);
            } else {
                if (base.signum() == 0) {
                    throw new DivisionByZeroException();
                }
                result = BigDecimal.ONE.divide(base.pow(-exponent), RESULT_SCALE, RoundingMode.HALF_EVEN);
            }
            PowerBounds.requireWithinIntegerDigits(result);
            return result;
        }
    },
    SQRT("sqrt") {
        @Override
        public int arity() {
            return 1;
        }

        @Override
        public void validate(List<Operand> operands) {
            if (left(operands).signum() < 0) {
                throw new InvalidOperandException(0, "must not be negative");
            }
        }

        @Override
        public BigDecimal apply(List<Operand> operands) {
            validate(operands);
            return left(operands).sqrt(MathContext.DECIMAL128).setScale(RESULT_SCALE, RoundingMode.HALF_EVEN);
        }
    },
    PERCENTAGE("percentage") {
        @Override
        public BigDecimal apply(List<Operand> operands) {
            return left(operands).multiply(right(operands)).movePointLeft(2);
        }
    };

    private static final int RESULT_SCALE = 10;
    private static final BigDecimal MIN_EXPONENT = BigDecimal.valueOf(-1000);
    private static final BigDecimal MAX_EXPONENT = BigDecimal.valueOf(1000);

    private final String code;

    Operation(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public int arity() {
        return 2;
    }

    /** Operation-specific operand checks; runs after the generic {@link Operand} bounds. No-op by default. */
    public void validate(List<Operand> operands) {
        // Most operations accept any in-range operand.
    }

    public abstract BigDecimal apply(List<Operand> operands);

    private static BigDecimal left(List<Operand> operands) {
        return operands.get(0).value();
    }

    private static BigDecimal right(List<Operand> operands) {
        return operands.get(1).value();
    }

    public static Operation fromCode(String code) {
        for (Operation operation : values()) {
            if (operation.code.equals(code)) {
                return operation;
            }
        }
        throw new UnsupportedCalculationException(code);
    }
}
