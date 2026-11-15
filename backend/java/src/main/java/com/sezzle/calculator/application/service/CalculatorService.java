package com.sezzle.calculator.application.service;

import com.sezzle.calculator.application.port.in.CalculateCommand;
import com.sezzle.calculator.application.port.in.CalculateUseCase;
import com.sezzle.calculator.domain.exception.InvalidOperandCountException;
import com.sezzle.calculator.domain.exception.OperandOutOfRangeException;
import com.sezzle.calculator.domain.model.CalculationResult;
import com.sezzle.calculator.domain.model.Operand;
import com.sezzle.calculator.domain.model.Operation;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class CalculatorService implements CalculateUseCase {

    @Override
    public CalculationResult calculate(CalculateCommand command) {
        Operation operation = Operation.fromCode(command.operation());
        List<BigDecimal> values = command.operands();
        if (values.size() != operation.arity()) {
            throw new InvalidOperandCountException(operation, operation.arity(), values.size());
        }
        List<Operand> operands = new ArrayList<>(values.size());
        for (int i = 0; i < values.size(); i++) {
            try {
                operands.add(new Operand(values.get(i)));
            } catch (OperandOutOfRangeException e) {
                throw e.withIndex(i);
            }
        }
        operation.validate(operands);
        return new CalculationResult(operation, operation.apply(operands));
    }
}
