package com.sezzle.calculator.adapter.in.web;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

@Schema(description = "Arithmetic operation request")
public record CalculationRequest(
        @Schema(
                description = "Lowercase operation code",
                example = "divide",
                allowableValues = {"add", "subtract", "multiply", "divide", "power", "sqrt", "percentage"})
        @NotNull
        String operation,

        @Schema(
                description =
                        "Operands as JSON numbers; the count depends on the operation: 1 for `sqrt`, 2 for the rest",
                example = "[1, 3]")
        @NotNull
        List<@NotNull BigDecimal> operands) {}
