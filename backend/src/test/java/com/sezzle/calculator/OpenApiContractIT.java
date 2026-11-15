package com.sezzle.calculator;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpenApiContractIT {

    private final HttpClient client = HttpClient.newHttpClient();
    private final JsonMapper mapper = JsonMapper.builder().build();

    @LocalServerPort
    private int port;

    @Test
    void apiDocsMatchSharedContract() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v3/api-docs"))
                .GET()
                .build();
        JsonNode actual = mapper.readTree(
                client.send(request, HttpResponse.BodyHandlers.ofString()).body());
        JsonNode expected =
                mapper.readTree(Files.readString(Path.of("../contract/openapi.json"), StandardCharsets.UTF_8));

        assertThat(actual.get("paths")).as("paths").isEqualTo(expected.get("paths"));
        assertThat(actual.get("components")).as("components").isEqualTo(expected.get("components"));
    }
}
