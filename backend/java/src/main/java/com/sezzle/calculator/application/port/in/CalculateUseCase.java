package com.sezzle.calculator.application.port.in;

import com.sezzle.calculator.domain.model.CalculationResult;

public interface CalculateUseCase {

    CalculationResult calculate(CalculateCommand command);
}
