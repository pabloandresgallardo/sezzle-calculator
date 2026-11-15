package com.sezzle.calculator.adapter.in.web;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Arithmetic operation result")
public record CalculationResponse(
        @Schema(description = "Operation that was performed", example = "divide")
        String operation,

        @Schema(description = "Plain decimal string, no exponent or trailing zeros", example = "0.3333333333")
        String result) {}
