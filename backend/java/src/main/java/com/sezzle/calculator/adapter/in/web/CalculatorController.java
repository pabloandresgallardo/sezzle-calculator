package com.sezzle.calculator.adapter.in.web;

import com.sezzle.calculator.application.port.in.CalculateCommand;
import com.sezzle.calculator.application.port.in.CalculateUseCase;
import com.sezzle.calculator.domain.model.CalculationResult;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Calculator")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CalculatorController {

    private final CalculateUseCase calculateUseCase;

    @Operation(
            summary = "Perform an arithmetic operation",
            requestBody =
                    @io.swagger.v3.oas.annotations.parameters.RequestBody(
                            required = true,
                            content =
                                    @Content(
                                            mediaType = MediaType.APPLICATION_JSON_VALUE,
                                            schema = @Schema(implementation = CalculationRequest.class),
                                            examples = {
                                                @ExampleObject(
                                                        name = "divide",
                                                        value = "{\"operation\":\"divide\",\"operands\":[1,3]}"),
                                                @ExampleObject(
                                                        name = "sqrt",
                                                        value = "{\"operation\":\"sqrt\",\"operands\":[2]}"),
                                                @ExampleObject(
                                                        name = "percentage",
                                                        value = "{\"operation\":\"percentage\",\"operands\":[20,150]}")
                                            })))
    @ApiResponse(
            responseCode = "200",
            description = "Operation result",
            content =
                    @Content(
                            mediaType = MediaType.APPLICATION_JSON_VALUE,
                            schema = @Schema(implementation = CalculationResponse.class),
                            examples =
                                    @ExampleObject(
                                            name = "divide",
                                            value = "{\"operation\":\"divide\",\"result\":\"0.3333333333\"}")))
    @ApiResponse(
            responseCode = "400",
            description = "Malformed request, unsupported operation, invalid operand count,"
                    + " operand out of range, invalid operand, result out of range or division by zero",
            content =
                    @Content(
                            mediaType = MediaType.APPLICATION_PROBLEM_JSON_VALUE,
                            schema = @Schema(implementation = ProblemDetail.class)))
    @PostMapping(
            path = "/calculate",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public CalculationResponse calculate(@Valid @RequestBody CalculationRequest request) {
        CalculationResult result =
                calculateUseCase.calculate(new CalculateCommand(request.operation(), request.operands()));
        return new CalculationResponse(result.operation().code(), result.formatted());
    }
}
