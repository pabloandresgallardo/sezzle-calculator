package com.sezzle.calculator.config;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.cfg.CoercionAction;
import tools.jackson.databind.cfg.CoercionInputShape;
import tools.jackson.databind.type.LogicalType;

/**
 * Strict JSON contract: unknown properties fail, numbers must be JSON numbers and strings must be JSON strings.
 */
@Configuration(proxyBeanMethods = false)
public class JacksonConfig {

    @Bean
    JsonMapperBuilderCustomizer strictJsonContract() {
        return builder -> {
            builder.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
            for (LogicalType numeric : new LogicalType[] {LogicalType.Float, LogicalType.Integer}) {
                builder.withCoercionConfig(
                        numeric,
                        config -> config.setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                                .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail));
            }
            builder.withCoercionConfig(
                    LogicalType.Textual,
                    config -> config.setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                            .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                            .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail));
        };
    }
}
