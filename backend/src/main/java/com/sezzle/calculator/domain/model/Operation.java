package com.sezzle.calculator.domain.model;

import com.sezzle.calculator.domain.exception.DivisionByZeroException;
import com.sezzle.calculator.domain.exception.UnsupportedCalculationException;
import java.math.BigDecimal;
import java.math.RoundingMode;

public enum Operation {
    ADD("add") {
        @Override
        public BigDecimal apply(Operand left, Operand right) {
            return left.value().add(right.value());
        }
    },
    SUBTRACT("subtract") {
        @Override
        public BigDecimal apply(Operand left, Operand right) {
            return left.value().subtract(right.value());
        }
    },
    MULTIPLY("multiply") {
        @Override
        public BigDecimal apply(Operand left, Operand right) {
            return left.value().multiply(right.value());
        }
    },
    DIVIDE("divide") {
        @Override
        public BigDecimal apply(Operand left, Operand right) {
            if (right.value().signum() == 0) {
                throw new DivisionByZeroException();
            }
            return left.value().divide(right.value(), DIVISION_SCALE, RoundingMode.HALF_EVEN);
        }
    };

    private static final int DIVISION_SCALE = 10;

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

    public abstract BigDecimal apply(Operand left, Operand right);

    public static Operation fromCode(String code) {
        for (Operation operation : values()) {
            if (operation.code.equals(code)) {
                return operation;
            }
        }
        throw new UnsupportedCalculationException(code);
    }
}
