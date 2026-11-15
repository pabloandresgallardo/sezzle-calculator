package com.sezzle.calculator;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ContractParityIT {

    private static final Path CASES = Path.of("../contract/parity-cases.json");

    private final HttpClient client = HttpClient.newHttpClient();

    @LocalServerPort
    private int port;

    static Stream<Arguments> cases() throws Exception {
        JsonNode root = JsonMapper.builder().build().readTree(Files.readString(CASES, StandardCharsets.UTF_8));
        List<Arguments> result = new ArrayList<>();
        for (JsonNode node : root) {
            result.add(Arguments.of(node.get("name").asString(), node));
        }
        return result.stream();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("cases")
    void matchesContract(String name, JsonNode testCase) throws Exception {
        JsonNode req = testCase.get("request");
        JsonNode exp = testCase.get("expected");

        HttpRequest.BodyPublisher publisher = req.has("body")
                ? HttpRequest.BodyPublishers.ofByteArray(
                        req.get("body").asString().getBytes(StandardCharsets.UTF_8))
                : HttpRequest.BodyPublishers.noBody();
        HttpRequest.Builder builder = HttpRequest.newBuilder(
                        URI.create("http://localhost:" + port + req.get("path").asString()))
                .method(req.get("method").asString(), publisher);
        for (var header : req.get("headers").properties()) {
            builder.header(header.getKey(), header.getValue().asString());
        }

        HttpResponse<byte[]> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());

        assertThat(response.statusCode())
                .as("status")
                .isEqualTo(exp.get("status").asInt());
        assertThat(response.headers().firstValue("Content-Type").orElse(null))
                .as("Content-Type")
                .isEqualTo(exp.get("contentType").asString());
        if (exp.has("allow")) {
            assertThat(response.headers().firstValue("Allow").orElse(null))
                    .as("Allow")
                    .isEqualTo(exp.get("allow").asString());
        }
        assertThat(response.body())
                .as("body bytes")
                .isEqualTo(exp.get("rawBody").asString().getBytes(StandardCharsets.UTF_8));
    }
}
