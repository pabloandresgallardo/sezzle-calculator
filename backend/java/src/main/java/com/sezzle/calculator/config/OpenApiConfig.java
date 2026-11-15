package com.sezzle.calculator.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import org.springframework.context.annotation.Configuration;

/** API metadata exposed at {@code /v3/api-docs} and Swagger UI. */
@Configuration
@OpenAPIDefinition(
        info =
                @Info(
                        title = "Sezzle Calculator API",
                        version = "v1",
                        description = "Arithmetic operations (add, subtract, multiply, divide, power, sqrt, percentage)"
                                + " over exact decimals (BigDecimal). "
                                + "Errors follow RFC 9457 ProblemDetail."))
public class OpenApiConfig {}
