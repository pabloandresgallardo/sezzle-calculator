package com.sezzle.calculator.adapter.in.web;

import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sezzle.calculator.application.service.CalculatorService;
import com.sezzle.calculator.config.JacksonConfig;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@WebMvcTest(CalculatorController.class)
@Import({CalculatorService.class, JacksonConfig.class, ProblemDetailHandler.class})
class CalculatorControllerTest {

    private static final String URL = "/api/v1/calculate";

    @Autowired
    private MockMvc mockMvc;

    private ResultActions postJson(String body) throws Exception {
        return mockMvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("successRows")
    void returnsResult(String body, String operation, String result) throws Exception {
        postJson(body)
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.operation").value(operation))
                .andExpect(jsonPath("$.result").value(result));
    }

    static Stream<Arguments> successRows() {
        return Stream.of(
                Arguments.of("{\"operation\":\"add\",\"operands\":[0.1,0.2]}", "add", "0.3"),
                Arguments.of("{\"operation\":\"divide\",\"operands\":[1,3]}", "divide", "0.3333333333"),
                Arguments.of("{\"operation\":\"power\",\"operands\":[2,64]}", "power", "18446744073709551616"),
                Arguments.of("{\"operation\":\"sqrt\",\"operands\":[2]}", "sqrt", "1.4142135624"),
                Arguments.of("{\"operation\":\"percentage\",\"operands\":[20,150]}", "percentage", "30"));
    }

    @Timeout(value = 5, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
    @ParameterizedTest(name = "{0} -> {1}")
    @ValueSource(
            strings = {
                "{\"operation\":\"add\",\"operands\":[0e-999999999,1]}",
                "{\"operation\":\"add\",\"operands\":[0e999999999,1]}"
            })
    void zeroWithHugeExponentIsNormalized(String body) throws Exception {
        postJson(body).andExpect(status().isOk()).andExpect(jsonPath("$.result").value("1"));
    }

    @ParameterizedTest(name = "{0} -> 400 {1}")
    @MethodSource("errorRows")
    void returnsProblemDetail(String body, String title) throws Exception {
        postJson(body)
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value(title))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.detail").isString());
    }

    static Stream<Arguments> errorRows() {
        return Stream.of(
                Arguments.of("{\"operation\":\"divide\",\"operands\":[5,0]}", "Division by zero"),
                Arguments.of("{\"operation\":\"sqrt\",\"operands\":[-4]}", "Invalid operand"),
                Arguments.of("{\"operation\":\"power\",\"operands\":[2,0.5]}", "Invalid operand"),
                Arguments.of("{\"operation\":\"power\",\"operands\":[2,1001]}", "Operand out of range"),
                Arguments.of("{\"operation\":\"power\",\"operands\":[10,100]}", "Result out of range"),
                Arguments.of("{\"operation\":\"power\",\"operands\":[0,-1]}", "Division by zero"),
                Arguments.of("{\"operation\":\"sqrt\",\"operands\":[]}", "Invalid operand count"),
                Arguments.of("{\"operation\":\"sqrt\",\"operands\":[1,2]}", "Invalid operand count"),
                Arguments.of("{\"operation\":\"sqrt\",\"operands\":[1e999999999]}", "Operand out of range"),
                Arguments.of("{\"operation\":\"PERCENTAGE\",\"operands\":[20,150]}", "Unsupported operation"),
                Arguments.of("{\"operation\":\"modulo\",\"operands\":[2,3]}", "Unsupported operation"),
                Arguments.of("{\"operation\":\"ADD\",\"operands\":[1,2]}", "Unsupported operation"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[1,2,3]}", "Invalid operand count"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[1234567890123456,1]}", "Operand out of range"),
                Arguments.of("{\"operation\":\"divide\",\"operands\":[1e999999999,0]}", "Operand out of range"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[\"1\",2]}", "Malformed request"),
                Arguments.of("{\"operation\":5,\"operands\":[1,2]}", "Malformed request"),
                Arguments.of("{\"operation\":true,\"operands\":[1,2]}", "Malformed request"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[1,2],\"foo\":1}", "Malformed request"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[1,null]}", "Malformed request"),
                Arguments.of("{\"operands\":[1,2]}", "Malformed request"),
                Arguments.of("{not json", "Malformed request"),
                Arguments.of("{\"operation\":\"add\",\"operands\":[true,2]}", "Malformed request"));
    }

    @Test
    void operandOutOfRangeDetailNamesTheIndex() throws Exception {
        postJson("{\"operation\":\"add\",\"operands\":[1e999999999,0.1]}")
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.title").value("Operand out of range"))
                .andExpect(jsonPath("$.detail").value(startsWith("operands[0] ")));
    }

    @Test
    void validationDetailIsEnglishRegardlessOfLocale() throws Exception {
        mockMvc.perform(post(URL)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(HttpHeaders.ACCEPT_LANGUAGE, "es")
                        .content("{\"operation\":\"add\",\"operands\":[1,null]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Malformed request"))
                .andExpect(jsonPath("$.detail").value("operands[1] must not be null"));
    }

    @Test
    void unsupportedOperationDetailTruncatesLongCodes() throws Exception {
        String code = "x".repeat(100);
        postJson("{\"operation\":\"" + code + "\",\"operands\":[1,2]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Unsupported operation"))
                .andExpect(jsonPath("$.detail").value("unsupported operation: " + "x".repeat(32) + "\u2026"));
    }

    @Test
    void rejectsUnsupportedMediaType() throws Exception {
        mockMvc.perform(post(URL)
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("{\"operation\":\"add\",\"operands\":[1,2]}"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON));
    }
}
