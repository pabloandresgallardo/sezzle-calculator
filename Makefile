.PHONY: test test-java test-backend test-frontend test-go coverage build lint lint-go format run run-java run-backend run-frontend run-go up down e2e install

E2E_COMPOSE := docker compose -p sezzle-e2e -f docker-compose.test.yml
# The module is built in module mode even where the host sets GO111MODULE=off
GO := GO111MODULE=on go
# gofmt of the toolchain go.mod selects (the one on PATH may be older)
GOFMT = "$$(cd backend/go && $(GO) env GOROOT)/bin/gofmt"

install:
	cd frontend && npm ci
	cd e2e && npm ci && npx playwright install

test: test-java test-frontend test-go

test-java:
	cd backend/java && mvn -B test

# Old name, kept as an alias
test-backend: test-java

test-frontend:
	cd frontend && npm test

test-go:
	cd backend/go && $(GO) test -race ./...

# Unit + integration tests with coverage gates (90%); reports in backend/java/target/site/jacoco, frontend/coverage and backend/go/coverage
coverage:
	cd backend/java && mvn -B verify
	cd frontend && npm run test:coverage
	mkdir -p backend/go/coverage
	cd backend/go && $(GO) test -race -coverprofile=coverage/coverage.out ./... && sh scripts/coverage-gate.sh coverage/coverage.out 90

build:
	cd backend/java && mvn -B package -DskipTests
	cd frontend && npm run build
	cd backend/go && $(GO) build ./...

lint: lint-go
	cd backend/java && mvn -B spotless:check
	cd frontend && npm run lint

lint-go:
	@UNFORMATTED=$$($(GOFMT) -l backend/go); \
	if [ -n "$$UNFORMATTED" ]; then echo "gofmt needed:"; echo "$$UNFORMATTED"; exit 1; fi
	cd backend/go && $(GO) vet ./...

format:
	cd backend/java && mvn -B spotless:apply
	cd frontend && npm run format
	$(GOFMT) -w backend/go

# --remove-orphans: drops containers of services no longer in the file (the old `backend` holds 8090)
run:
	docker compose up --build --remove-orphans

run-java:
	cd backend/java && mvn -B spring-boot:run

# Old name, kept as an alias
run-backend: run-java

run-frontend:
	cd frontend && npm run dev

run-go:
	cd backend/go && $(GO) run ./cmd/server

# Detached stack on free host ports (reuses a port held by the same service of this project); prints the URLs
up:
	sh scripts/up.sh

down:
	sh scripts/down.sh

# Isolated stack on an ephemeral host port, torn down even when tests fail
e2e:
	$(E2E_COMPOSE) up -d --build --wait
	@PORT=$$($(E2E_COMPOSE) port web 80 | cut -d: -f2); \
	(cd e2e && E2E_BASE_URL=http://localhost:$$PORT npm test); \
	STATUS=$$?; \
	$(E2E_COMPOSE) down -v; \
	exit $$STATUS
