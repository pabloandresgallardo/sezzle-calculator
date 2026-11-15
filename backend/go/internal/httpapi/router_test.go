package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/app"
	"github.com/pabloandresgallardo/sezzle-calculator/backend/go/internal/domain"
)

const calcPath = "/api/v1/calculate"

func problemJSON(detail, instance, status, title string) string {
	return `{"detail":"` + detail + `","instance":"` + instance + `","status":` + status + `,"title":"` + title + `"}`
}

func serve(t *testing.T, h http.Handler, method, target string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var jsonCT = map[string]string{"Content-Type": "application/json"}

func TestMethodNotAllowed(t *testing.T) {
	h := NewHandler()
	for _, m := range []string{"GET", "PUT", "DELETE", "PATCH"} {
		for _, ct := range []string{"", "text/plain", "application/json"} {
			rec := serve(t, h, m, calcPath, map[string]string{"Content-Type": ct, "Accept": "text/plain"}, okBody)
			if rec.Code != 405 || rec.Header().Get("Allow") != "POST" {
				t.Fatalf("%s ct=%q: status %d Allow %q", m, ct, rec.Code, rec.Header().Get("Allow"))
			}
			want := problemJSON("Method '"+m+"' is not supported.", calcPath, "405", "Method Not Allowed")
			if rec.Body.String() != want || rec.Header().Get("Content-Type") != "application/problem+json" {
				t.Fatalf("%s: body %s ct %q", m, rec.Body, rec.Header().Get("Content-Type"))
			}
		}
	}
}

func TestHeadAndOptionsOnCalculate(t *testing.T) {
	srv := httptest.NewServer(NewHandler())
	defer srv.Close()
	resp, body := sendRaw(t, srv.Listener.Addr().String(), "HEAD", calcPath, nil, nil)
	if resp.StatusCode != 405 || resp.Header.Get("Allow") != "POST" || len(body) != 0 ||
		resp.Header.Get("Content-Type") != "application/problem+json" {
		t.Fatalf("HEAD: %d Allow=%q ct=%q body=%q", resp.StatusCode, resp.Header.Get("Allow"), resp.Header.Get("Content-Type"), body)
	}

	rec := serve(t, NewHandler(), "OPTIONS", calcPath, nil, "")
	if rec.Code != 200 || rec.Header().Get("Allow") != "POST,OPTIONS" || rec.Body.Len() != 0 {
		t.Fatalf("OPTIONS: %d Allow=%q body=%q", rec.Code, rec.Header().Get("Allow"), rec.Body)
	}
}

func TestUnsupportedMediaType(t *testing.T) {
	h := NewHandler()
	accepted := []string{"application/json", "application/json;charset=UTF-8", "application/json; charset=utf-8", "APPLICATION/JSON", `application/json; charset="utf-8"`, "application/json;", "application/json;foo", `application/json;x="a;b\"c;d"`}
	for _, ct := range accepted {
		if rec := serve(t, h, "POST", calcPath, map[string]string{"Content-Type": ct}, okBody); rec.Code != 200 {
			t.Errorf("Content-Type %q: status %d, want 200 (%s)", ct, rec.Code, rec.Body)
		}
	}
	rejected := map[string]string{
		"":                                   "Content-Type 'null' is not supported.",
		"   ":                                "Content-Type 'null' is not supported.",
		"text/plain":                         "Content-Type 'text/plain' is not supported.",
		"TEXT/Plain; Charset=utf-8":          "Content-Type 'text/plain;Charset=utf-8' is not supported.",
		"application/problem+json":           "Content-Type 'application/problem+json' is not supported.",
		"application/merge-patch+json":       "Content-Type 'application/merge-patch+json' is not supported.",
		"application/*":                      "Content-Type 'application/*' is not supported.",
		"*":                                  "Content-Type '*/*' is not supported.",
		"application/x-www-form-urlencoded":  "Content-Type 'application/x-www-form-urlencoded' is not supported.",
		"garbage":                            "Could not parse Content-Type.",
		"application/":                       "Could not parse Content-Type.",
		"/json":                              "Could not parse Content-Type.",
		"application/json;charset=bogus":     "Could not parse Content-Type.",
		"application/js on":                  "Could not parse Content-Type.",
		"application/json;a=b c":             "Could not parse Content-Type.",
		"application/json;a b=c":             "Could not parse Content-Type.",
		"*/json":                             "Could not parse Content-Type.",
		`application/json;charset="unclosed`: "Could not parse Content-Type.",
	}
	for ct, detail := range rejected {
		// Accept: text/plain too: 415 is checked before 406.
		rec := serve(t, h, "POST", calcPath, map[string]string{"Content-Type": ct, "Accept": "text/plain"}, okBody)
		want := problemJSON(detail, calcPath, "415", "Unsupported Media Type")
		if rec.Code != 415 || rec.Body.String() != want || rec.Header().Get("Accept") != "application/json" {
			t.Errorf("Content-Type %q: %d Accept=%q body %s, want %s", ct, rec.Code, rec.Header().Get("Accept"), rec.Body, want)
		}
	}
}

func TestNotAcceptable(t *testing.T) {
	h := NewHandler()
	accepted := []string{"", "*/*", "application/json", "application/*", "application/*+json", "*/*;q=0.1",
		"text/plain, application/json", "application/json, application/problem+json", "application/json;q=0",
		"application/json;charset=UTF-8", "Application/JSON", `text/plain;x="a,b", application/json`}
	for _, a := range accepted {
		rec := serve(t, h, "POST", calcPath, map[string]string{"Content-Type": "application/json", "Accept": a}, okBody)
		if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
			t.Errorf("Accept %q: %d %q", a, rec.Code, rec.Header().Get("Content-Type"))
		}
	}
	want := problemJSON("Acceptable representations: [application/json].", calcPath, "406", "Not Acceptable")
	for _, a := range []string{"text/plain", "text/html", "application/xml", "application/problem+json", "text/*"} {
		// The body is not parsed: a broken body still gives 406.
		rec := serve(t, h, "POST", calcPath, map[string]string{"Content-Type": "application/json", "Accept": a}, "{")
		if rec.Code != 406 || rec.Body.String() != want || rec.Header().Get("Accept") != "application/json" ||
			rec.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("Accept %q: %d Accept=%q body %s", a, rec.Code, rec.Header().Get("Accept"), rec.Body)
		}
	}
	for _, a := range []string{"garbage", "application/json;q=abc", "application/json;q=2", "*/json"} {
		rec := serve(t, h, "POST", calcPath, map[string]string{"Content-Type": "application/json", "Accept": a}, okBody)
		if rec.Code != 406 || rec.Body.Len() != 0 || rec.Header().Get("Content-Type") != "" || rec.Header().Get("Accept") != "application/json" {
			t.Errorf("Accept %q: %d ct=%q body %q", a, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
		}
	}
}

func TestNotFound(t *testing.T) {
	h := NewHandler()
	cases := map[string]string{
		"/nope":                  "nope",
		"/":                      "",
		"/api/v1":                "api/v1",
		"/api/v1/Calculate":      "api/v1/Calculate",
		"/api/v1/calculate.json": "api/v1/calculate.json",
		"/api/v1//calculate":     "api/v1/calculate",
		"/api/v1/calculate/":     "api/v1/calculate",
		"/actuator/info":         "actuator/info",
		"/nope?x=1":              "nope",
	}
	for target, res := range cases {
		for _, m := range []string{"GET", "POST"} {
			rec := serve(t, h, m, target, map[string]string{"Accept": "text/html"}, "")
			instance, _, _ := strings.Cut(target, "?")
			want := problemJSON("No static resource "+res+".", instance, "404", "Not Found")
			if rec.Code != 404 || rec.Body.String() != want || rec.Header().Get("Content-Type") != "application/problem+json" {
				t.Errorf("%s %s: %d %s, want %s", m, target, rec.Code, rec.Body, want)
			}
		}
	}
}

// Java prints the raw (still percent-encoded) path in the 404 detail, the
// same form as instance; only the routing uses the decoded path.
func TestNotFoundDetailUsesRawPath(t *testing.T) {
	h := NewHandler()
	cases := map[string]string{
		"/api/v1/calculate%20":   "api/v1/calculate%20",
		"/a%20b":                 "a%20b",
		"/%E2%82%AC":             "%E2%82%AC",
		"/api/v1/calculate%00":   "api/v1/calculate%00",
		"/api/v1/calculate%3Fx":  "api/v1/calculate%3Fx",
		"/api/v1/calcul%C3%A1te": "api/v1/calcul%C3%A1te",
		"/api/v1//calculate%20/": "api/v1/calculate%20",
	}
	for target, res := range cases {
		rec := serve(t, h, "POST", target, jsonCT, okBody)
		want := problemJSON("No static resource "+res+".", target, "404", "Not Found")
		if rec.Code != 404 || rec.Body.String() != want {
			t.Errorf("POST %s: %d %s, want %s", target, rec.Code, rec.Body, want)
		}
	}
}

func TestPathDecodedForRoutingButRawInInstance(t *testing.T) {
	h := NewHandler()
	rec := serve(t, h, "POST", "/api/v1/%63alculate", jsonCT, `{"operation":"divide","operands":[1,0]}`)
	want := problemJSON("division by zero", "/api/v1/%63alculate", "400", "Division by zero")
	if rec.Code != 400 || rec.Body.String() != want {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	rec = serve(t, h, "POST", "/api/v1/calculate?x=1&operation=sub", jsonCT, okBody)
	if rec.Code != 200 || rec.Body.String() != `{"operation":"add","result":"3"}` {
		t.Fatalf("query: %d %s", rec.Code, rec.Body)
	}
}

func TestInstanceFromAbsoluteRequestURI(t *testing.T) {
	req := httptest.NewRequest("POST", "http://example.com/api/v1/calculate?q=1", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	NewHandler().ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"instance":"/api/v1/calculate"`) {
		t.Fatalf("instance: %s", rec.Body)
	}
}

func TestErrorTitles(t *testing.T) {
	cases := []struct {
		err    error
		status int
		title  string
	}{
		{&malformedError{detail: shapeDetail}, 400, "Malformed request"},
		{&domain.UnsupportedOperationError{Code: "x"}, 400, "Unsupported operation"},
		{&domain.InvalidOperandCountError{Code: "add", Expected: 2, Actual: 1}, 400, "Invalid operand count"},
		{&domain.OperandOutOfRangeError{Index: 0, Reason: "r"}, 400, "Operand out of range"},
		{&domain.InvalidOperandError{Index: 0, Reason: "r"}, 400, "Invalid operand"},
		{&domain.ResultOutOfRangeError{}, 400, "Result out of range"},
		{&domain.DivisionByZeroError{}, 400, "Division by zero"},
		{errors.New("boom"), 500, "Internal error"},
	}
	for _, c := range cases {
		h := newHandler(func(app.Command) (app.Result, error) { return app.Result{}, c.err })
		rec := serve(t, h, "POST", calcPath, jsonCT, okBody)
		detail := c.err.Error()
		if c.status == 500 {
			detail = "An unexpected error occurred"
		}
		want := problemJSON(detail, calcPath, itoa(c.status), c.title)
		if rec.Code != c.status || rec.Body.String() != want || rec.Header().Get("Content-Type") != "application/problem+json" {
			t.Errorf("%T: %d %s, want %s", c.err, rec.Code, rec.Body, want)
		}
	}
}

func TestPanicIsInternalError(t *testing.T) {
	h := newHandler(func(app.Command) (app.Result, error) { panic("kaboom") })
	rec := serve(t, h, "POST", calcPath, jsonCT, okBody)
	want := problemJSON("An unexpected error occurred", calcPath, "500", "Internal error")
	if rec.Code != 500 || rec.Body.String() != want {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestDecodeErrorSkipsCalculate(t *testing.T) {
	called := false
	h := newHandler(func(app.Command) (app.Result, error) { called = true; return app.Result{}, nil })
	rec := serve(t, h, "POST", calcPath, jsonCT, `{"operation":"nope","operands":[null]}`)
	if called || rec.Code != 400 || !strings.Contains(rec.Body.String(), `"detail":"operands[0] must not be null"`) {
		t.Fatalf("called=%v %d %s", called, rec.Code, rec.Body)
	}
}

func TestSuccessEscaping(t *testing.T) {
	rec := serve(t, NewHandler(), "POST", calcPath, jsonCT, `{"operation":"<b>&\u2028","operands":[1,2]}`)
	want := problemJSON("unsupported operation: <b>&\u2028", calcPath, "400", "Unsupported operation")
	if rec.Body.String() != want {
		t.Fatalf("%s", rec.Body)
	}
}

func TestHealth(t *testing.T) {
	h := NewHandler()
	const actuator = "application/vnd.spring-boot.actuator.v3+json"
	cases := []struct{ path, accept, ct, body string }{
		{"/actuator/health", "", actuator, `{"groups":["liveness","readiness"],"status":"UP"}`},
		{"/actuator/health", "*/*", actuator, `{"groups":["liveness","readiness"],"status":"UP"}`},
		{"/actuator/health", "application/json", "application/json", `{"groups":["liveness","readiness"],"status":"UP"}`},
		{"/actuator/health", "application/json, " + actuator, actuator, `{"groups":["liveness","readiness"],"status":"UP"}`},
		{"/actuator/health", "garbage", actuator, `{"groups":["liveness","readiness"],"status":"UP"}`},
		{"/actuator/health/liveness", "", actuator, `{"status":"UP"}`},
		{"/actuator/health/readiness", "application/json", "application/json", `{"status":"UP"}`},
	}
	for _, c := range cases {
		rec := serve(t, h, "GET", c.path, map[string]string{"Accept": c.accept}, "")
		if rec.Code != 200 || rec.Header().Get("Content-Type") != c.ct || rec.Body.String() != c.body {
			t.Errorf("%s Accept=%q: %d %q %s", c.path, c.accept, rec.Code, rec.Header().Get("Content-Type"), rec.Body)
		}
	}
	rec := serve(t, h, "POST", "/actuator/health", jsonCT, "{}")
	want := problemJSON("Method 'POST' is not supported.", "/actuator/health", "405", "Method Not Allowed")
	if rec.Code != 405 || rec.Header().Get("Allow") != "GET" || rec.Body.String() != want {
		t.Errorf("POST health: %d Allow=%q %s", rec.Code, rec.Header().Get("Allow"), rec.Body)
	}
	rec = serve(t, h, "OPTIONS", "/actuator/health", nil, "")
	if rec.Code != 200 || rec.Header().Get("Allow") != "GET,HEAD,OPTIONS" {
		t.Errorf("OPTIONS health: %d Allow=%q", rec.Code, rec.Header().Get("Allow"))
	}

	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, body := sendRaw(t, srv.Listener.Addr().String(), "HEAD", "/actuator/health", nil, nil)
	if resp.StatusCode != 200 || len(body) != 0 {
		t.Errorf("HEAD health: %d %q", resp.StatusCode, body)
	}
}

func TestOpenAPIServersFromRequest(t *testing.T) {
	h := NewHandler()
	for _, host := range []string{"localhost:18099", "example.com", "127.0.0.1:8091"} {
		req := httptest.NewRequest("GET", "/v3/api-docs", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
			t.Fatalf("%d %q", rec.Code, rec.Header().Get("Content-Type"))
		}
		var doc struct {
			Servers []struct {
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"servers"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
			t.Fatalf("api-docs not JSON: %v", err)
		}
		if len(doc.Servers) != 1 || doc.Servers[0].URL != "http://"+host || doc.Servers[0].Description != "Generated server url" {
			t.Fatalf("servers = %+v", doc.Servers)
		}
		// Java (springdoc) order: url before description; openapi first.
		if !strings.Contains(rec.Body.String(), `"servers":[{"url":"http://`+host+`","description":"Generated server url"}]`) ||
			!strings.HasPrefix(rec.Body.String(), `{"openapi":"3.1.0","info":`) {
			t.Fatalf("layout: %.200s", rec.Body)
		}
	}
}

func TestOpenAPIContentMatchesContract(t *testing.T) {
	rec := serve(t, NewHandler(), "GET", "/v3/api-docs", nil, "")
	var served map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &served); err != nil {
		t.Fatal(err)
	}
	delete(served, "servers")
	raw, err := os.ReadFile(contractOpenAPIPath)
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(served)
	b, _ := json.Marshal(want)
	if !bytes.Equal(a, b) {
		t.Fatalf("served api-docs (minus servers) differ from contract/openapi.json")
	}
	if bytes.Contains(rec.Body.Bytes(), []byte(`&`)) || bytes.Contains(rec.Body.Bytes(), []byte(`<`)) {
		t.Fatalf("HTML characters must not be escaped")
	}
}

func TestOpenAPIDocument(t *testing.T) {
	out, err := openAPIWithServer([]byte(`{"zeta":1,"paths":{},"openapi":"3.1.0","extra":"<&>"}`), "h")
	if err != nil {
		t.Fatal(err)
	}
	want := `{"openapi":"3.1.0","servers":[{"url":"http://h","description":"Generated server url"}],"paths":{},"extra":"<&>","zeta":1}`
	if string(out) != want {
		t.Fatalf("got %s", out)
	}
	if _, err := openAPIWithServer([]byte(`[]`), "h"); err == nil {
		t.Fatal("want error for a non-object document")
	}
}

func TestSwaggerRedirect(t *testing.T) {
	rec := serve(t, NewHandler(), "GET", "/swagger-ui.html", nil, "")
	if rec.Code != 302 || rec.Header().Get("Location") != "/swagger-ui/index.html" || rec.Body.Len() != 0 {
		t.Fatalf("%d Location=%q body=%q", rec.Code, rec.Header().Get("Location"), rec.Body)
	}
}

func TestSwaggerIndex(t *testing.T) {
	rec := serve(t, NewHandler(), "GET", "/swagger-ui/index.html", nil, "")
	body := rec.Body.String()
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "text/html" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %q %q", rec.Code, rec.Header().Get("Content-Type"), rec.Header().Get("Cache-Control"))
	}
	for _, s := range []string{"https://unpkg.com/swagger-ui-dist@5.35.0/swagger-ui-bundle.js", "https://unpkg.com/swagger-ui-dist@5.35.0/swagger-ui.css", "url: '/v3/api-docs'"} {
		if !strings.Contains(body, s) {
			t.Errorf("swagger page lacks %q", s)
		}
	}
	rec = serve(t, NewHandler(), "POST", "/swagger-ui/index.html", nil, "")
	if rec.Code != 405 || rec.Header().Get("Allow") != "GET" {
		t.Errorf("POST swagger: %d %q", rec.Code, rec.Header().Get("Allow"))
	}
}

// Every unpkg asset is pinned by Subresource Integrity, so a tampered CDN file is refused.
func TestSwaggerAssetsHaveSRI(t *testing.T) {
	tags := regexp.MustCompile(`<(?:script|link)\b[^>]*https://unpkg\.com/[^>]*>`).FindAllString(string(swaggerHTML), -1)
	if len(tags) != 3 {
		t.Fatalf("unpkg tags = %d, want 3 (css, bundle, preset): %q", len(tags), tags)
	}
	integrity := regexp.MustCompile(`\bintegrity="sha384-[A-Za-z0-9+/]{64}"`)
	for _, tag := range tags {
		if !integrity.MatchString(tag) {
			t.Errorf("no sha384 integrity attribute: %s", tag)
		}
		if !strings.Contains(tag, `crossorigin="anonymous"`) {
			t.Errorf("no crossorigin=\"anonymous\": %s", tag)
		}
	}
}

func itoa(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}
