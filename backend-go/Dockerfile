FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Static binary on distroless (no shell, no curl): the compose healthcheck
# runs ["CMD", "/server", "-healthcheck"]. No HEALTHCHECK here on purpose.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
ENV PORT=8091
EXPOSE 8091
USER nonroot:nonroot
ENTRYPOINT ["/server"]
