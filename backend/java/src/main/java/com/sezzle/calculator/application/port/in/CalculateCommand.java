package com.sezzle.calculator.application.port.in;

import java.math.BigDecimal;
import java.util.List;

public record CalculateCommand(String operation, List<BigDecimal> operands) {}
