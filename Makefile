.PHONY: test test-backend test-frontend coverage build lint format run run-backend run-frontend e2e install

E2E_COMPOSE := docker compose -p sezzle-e2e -f docker-compose.test.yml

install:
	cd frontend && npm ci
	cd e2e && npm ci && npx playwright install

test: test-backend test-frontend

test-backend:
	cd backend && mvn -B test

test-frontend:
	cd frontend && npm test

# Unit + integration tests with coverage gates (90%); reports in backend/target/site/jacoco and frontend/coverage
coverage:
	cd backend && mvn -B verify
	cd frontend && npm run test:coverage

build:
	cd backend && mvn -B package -DskipTests
	cd frontend && npm run build

lint:
	cd backend && mvn -B spotless:check
	cd frontend && npm run lint

format:
	cd backend && mvn -B spotless:apply
	cd frontend && npm run format

run:
	docker compose up --build

run-backend:
	cd backend && mvn -B spring-boot:run

run-frontend:
	cd frontend && npm run dev

# Isolated stack on an ephemeral host port, torn down even when tests fail
e2e:
	$(E2E_COMPOSE) up -d --build --wait
	@PORT=$$($(E2E_COMPOSE) port web 80 | cut -d: -f2); \
	(cd e2e && E2E_BASE_URL=http://localhost:$$PORT npm test); \
	STATUS=$$?; \
	$(E2E_COMPOSE) down -v; \
	exit $$STATUS
