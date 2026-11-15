package com.sezzle.calculator.adapter.in.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.http.ProblemDetail;
import org.springframework.validation.FieldError;

class ProblemDetailHandlerTest {

    private final ProblemDetailHandler handler = new ProblemDetailHandler();

    @Test
    void unexpectedErrorBecomesGenericInternalError() {
        ProblemDetail problem = handler.handleUnexpected(new IllegalStateException("secret internals"));

        assertThat(problem.getStatus()).isEqualTo(500);
        assertThat(problem.getTitle()).isEqualTo("Internal error");
        assertThat(problem.getDetail()).isEqualTo("An unexpected error occurred");
        assertThat(problem.getProperties()).isNull();
    }

    @Test
    void describesFieldErrorsWithoutLocalizedMessages() {
        FieldError notNull = new FieldError(
                "request", "operands[1]", null, false, new String[] {"NotNull"}, null, "no debe ser nulo");
        FieldError other = new FieldError("request", "operation", null, false, new String[] {"Size"}, null, "tamaño");

        assertThat(ProblemDetailHandler.describe(notNull)).isEqualTo("operands[1] must not be null");
        assertThat(ProblemDetailHandler.describe(other)).isEqualTo("operation is invalid");
    }
}
