package com.sezzle.calculator;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CalculatorApiIT {

    private static final String CALCULATE = "/api/v1/calculate";

    private final HttpClient client = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    private HttpResponse<String> post(String body) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + CALCULATE))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String path) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .GET()
                .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void addDecimalsReturnsExactResult() throws Exception {
        HttpResponse<String> response = post("{\"operation\":\"add\",\"operands\":[0.1,0.2]}");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"operation\":\"add\"").contains("\"result\":\"0.3\"");
    }

    @Test
    void divideByZeroReturnsProblemDetail() throws Exception {
        HttpResponse<String> response = post("{\"operation\":\"divide\",\"operands\":[5,0]}");

        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("application/problem+json");
        assertThat(response.body()).contains("\"title\":\"Division by zero\"");
    }

    @Test
    void outOfRangeOperandReturnsProblemDetail() throws Exception {
        HttpResponse<String> response = post("{\"operation\":\"add\",\"operands\":[1e999999999,0.1]}");

        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.body()).contains("\"title\":\"Operand out of range\"");
    }

    @Test
    void openApiDocumentsCalculateEndpoint() throws Exception {
        HttpResponse<String> response = get("/v3/api-docs");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"/api/v1/calculate\"");
        JsonNode info = JsonMapper.shared().readTree(response.body()).path("info");
        assertThat(info.path("title").asString()).isEqualTo("Sezzle Calculator API");
        assertThat(info.path("version").asString()).isEqualTo("v1");
        assertThat(info.path("description").asString()).contains("RFC 9457");
    }

    @Test
    void healthIsUp() throws Exception {
        HttpResponse<String> response = get("/actuator/health");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("\"status\":\"UP\"");
    }
}
