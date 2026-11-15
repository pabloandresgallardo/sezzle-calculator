package com.sezzle.calculator.adapter.in.web;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

@Schema(description = "Arithmetic operation request")
public record CalculationRequest(
        @Schema(description = "Lowercase operation code", example = "divide") @NotNull
        String operation,

        @Schema(description = "Operands as JSON numbers", example = "[1, 3]") @NotNull
        List<@NotNull BigDecimal> operands) {}
