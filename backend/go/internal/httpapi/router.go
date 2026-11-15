// Package httpapi is the HTTP adapter: it reproduces the observable HTTP
// behavior of the Java backend (routes, status precedence, ProblemDetail
// bodies, exact Content-Type values) over the app use case.
package httpapi

import (
	"io"
	"net/http"
	"strings"

	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/app"
	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/domain"
)

const internalErrorDetail = "An unexpected error occurred"

type calculateFunc func(app.Command) (app.Result, error)

type handler struct {
	calculate calculateFunc
}

// NewHandler returns the full HTTP API:
//   - POST /api/v1/calculate
//   - GET  /actuator/health (and /liveness, /readiness)
//   - GET  /v3/api-docs, /swagger-ui.html (302), /swagger-ui/index.html
//
// Any other path is a 404 ProblemDetail. Paths match exactly on the decoded
// path (no trailing-slash or double-slash cleanup), and the query string is
// ignored.
func NewHandler() http.Handler {
	return newHandler(app.Calculate)
}

func newHandler(calc calculateFunc) http.Handler {
	return &handler{calculate: calc}
}

// getRoutes are the read-only endpoints; all answer GET and HEAD.
var getRoutes = map[string]http.HandlerFunc{
	"/actuator/health":           healthHandler(healthBody),
	"/actuator/health/liveness":  healthHandler(probeBody),
	"/actuator/health/readiness": healthHandler(probeBody),
	"/v3/api-docs":               serveOpenAPI,
	"/swagger-ui.html":           redirectSwagger,
	"/swagger-ui/index.html":     serveSwaggerUI,
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/api/v1/calculate" {
		switch r.Method {
		case http.MethodPost:
			h.serveCalculate(w, r)
		case http.MethodOptions:
			writeOptions(w, "POST,OPTIONS")
		default:
			methodNotAllowed(w, r, "POST")
		}
		return
	}
	if route, ok := getRoutes[path]; ok {
		switch r.Method {
		case http.MethodGet, http.MethodHead:
			route(w, r)
		case http.MethodOptions:
			writeOptions(w, "GET,HEAD,OPTIONS")
		default:
			methodNotAllowed(w, r, "GET")
		}
		return
	}
	writeProblem(w, r, http.StatusNotFound, "Not Found", "No static resource "+resourceName(instancePath(r))+".")
}

// resourceName is the raw (still percent-encoded) path as Spring's
// static-resource 404 prints it: repeated slashes collapsed, leading and
// trailing slashes removed. Routing uses the decoded path; this does not.
func resourceName(path string) string {
	for strings.Contains(path, "//") {
		path = strings.ReplaceAll(path, "//", "/")
	}
	return strings.Trim(path, "/")
}

func writeOptions(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusOK)
}

func methodNotAllowed(w http.ResponseWriter, r *http.Request, allow string) {
	w.Header().Set("Allow", allow)
	writeProblem(w, r, http.StatusMethodNotAllowed, "Method Not Allowed", "Method '"+r.Method+"' is not supported.")
}

// serveCalculate applies Spring's checks in order: Content-Type (415), then
// Accept (406), then the body, then the use case.
func (h *handler) serveCalculate(w http.ResponseWriter, r *http.Request) {
	if detail, ok := checkContentType(r.Header.Get("Content-Type")); !ok {
		w.Header().Set("Accept", contentTypeJSON)
		writeProblem(w, r, http.StatusUnsupportedMediaType, "Unsupported Media Type", detail)
		return
	}
	switch acceptsJSON(r.Header.Values("Accept")) {
	case acceptUnparseable:
		// Spring answers an unparseable Accept with an empty 406.
		w.Header().Set("Accept", contentTypeJSON)
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusNotAcceptable)
		return
	case acceptRejected:
		w.Header().Set("Accept", contentTypeJSON)
		writeProblem(w, r, http.StatusNotAcceptable, "Not Acceptable", "Acceptable representations: [application/json].")
		return
	}

	defer func() {
		if rec := recover(); rec != nil {
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			writeProblem(w, r, http.StatusInternalServerError, "Internal error", internalErrorDetail)
		}
	}()

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, r, errShape)
		return
	}
	cmd, err := decodeCommand(body)
	if err != nil {
		writeError(w, r, err)
		return
	}
	result, err := h.calculate(cmd)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]byte, 0, 64)
	out = append(out, `{"operation":`...)
	out = appendJSONString(out, result.Operation)
	out = append(out, `,"result":`...)
	out = appendJSONString(out, result.Formatted())
	out = append(out, '}')
	writeBody(w, http.StatusOK, contentTypeJSON, out)
}

// checkContentType implements consumes = application/json.
func checkContentType(header string) (detail string, ok bool) {
	if strings.TrimSpace(header) == "" {
		return "Content-Type 'null' is not supported.", false
	}
	m, parsed := parseMediaType(header, false)
	if !parsed {
		return "Could not parse Content-Type.", false
	}
	if m.typ != "application" || m.sub != "json" {
		return "Content-Type '" + m.String() + "' is not supported.", false
	}
	return "", true
}

type acceptResult int

const (
	acceptOK acceptResult = iota
	acceptRejected
	acceptUnparseable
)

// acceptsJSON implements produces = application/json. A missing or empty
// Accept means */*; q=0 is not treated as a rejection (as in Spring).
func acceptsJSON(values []string) acceptResult {
	types, ok := parseAccept(values)
	if !ok {
		return acceptUnparseable
	}
	if len(types) == 0 {
		return acceptOK
	}
	for _, m := range types {
		if m.typ == "*" || (m.typ == "application" && (m.sub == "*" || m.sub == "json" || m.sub == "*+json")) {
			return acceptOK
		}
	}
	return acceptRejected
}

// writeError maps a pipeline error to its ProblemDetail (Java
// ProblemDetailHandler titles). Anything unknown is a 500.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var title string
	switch err.(type) {
	case *malformedError:
		title = "Malformed request"
	case *domain.UnsupportedOperationError:
		title = "Unsupported operation"
	case *domain.InvalidOperandCountError:
		title = "Invalid operand count"
	case *domain.OperandOutOfRangeError:
		title = "Operand out of range"
	case *domain.InvalidOperandError:
		title = "Invalid operand"
	case *domain.ResultOutOfRangeError:
		title = "Result out of range"
	case *domain.DivisionByZeroError:
		title = "Division by zero"
	default:
		writeProblem(w, r, http.StatusInternalServerError, "Internal error", internalErrorDetail)
		return
	}
	writeProblem(w, r, http.StatusBadRequest, title, err.Error())
}
