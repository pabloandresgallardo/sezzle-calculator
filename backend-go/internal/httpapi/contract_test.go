package httpapi

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"testing"
	"time"
)

// Shared contract files (repo root /contract), relative to this package.
const (
	parityCasesPath     = "../../../contract/parity-cases.json"
	contractOpenAPIPath = "../../../contract/openapi.json"
)

type parityCase struct {
	Name     string `json:"name"`
	ViaProxy bool   `json:"viaProxy"`
	Request  struct {
		Method  string            `json:"method"`
		Path    string            `json:"path"`
		Headers map[string]string `json:"headers"`
		Body    *string           `json:"body"`
	} `json:"request"`
	Expected struct {
		Status      int     `json:"status"`
		ContentType string  `json:"contentType"`
		RawBody     string  `json:"rawBody"`
		Allow       *string `json:"allow"`
	} `json:"expected"`
}

func loadParityCases(t *testing.T) []parityCase {
	t.Helper()
	data, err := os.ReadFile(parityCasesPath)
	if err != nil {
		t.Fatalf("read %s: %v", parityCasesPath, err)
	}
	var cases []parityCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse %s: %v", parityCasesPath, err)
	}
	return cases
}

// sendRaw writes the request as raw HTTP/1.1 bytes, so exactly the fixture's
// headers are sent (no implicit Content-Type, User-Agent or Accept-Encoding).
func sendRaw(t *testing.T, addr, method, target string, headers map[string]string, body *string) (*http.Response, []byte) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	var b bytes.Buffer
	fmt.Fprintf(&b, "%s %s HTTP/1.1\r\nHost: %s\r\n", method, target, addr)
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, k := range names {
		fmt.Fprintf(&b, "%s: %s\r\n", k, headers[k])
	}
	if body != nil {
		fmt.Fprintf(&b, "Content-Length: %d\r\n", len(*body))
	}
	b.WriteString("Connection: close\r\n\r\n")
	if body != nil {
		b.WriteString(*body)
	}
	if _, err := conn.Write(b.Bytes()); err != nil {
		t.Fatalf("write: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: method})
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp, raw
}

func TestParityCases(t *testing.T) {
	cases := loadParityCases(t)
	if len(cases) != 80 {
		t.Fatalf("parity fixture has %d cases, want 80", len(cases))
	}
	srv := httptest.NewServer(NewHandler())
	defer srv.Close()
	addr := srv.Listener.Addr().String()

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			resp, body := sendRaw(t, addr, c.Request.Method, c.Request.Path, c.Request.Headers, c.Request.Body)
			if resp.StatusCode != c.Expected.Status {
				t.Errorf("status = %d, want %d", resp.StatusCode, c.Expected.Status)
			}
			if got := resp.Header.Get("Content-Type"); got != c.Expected.ContentType {
				t.Errorf("Content-Type = %q, want %q", got, c.Expected.ContentType)
			}
			if c.Expected.Allow != nil {
				if got := resp.Header.Get("Allow"); got != *c.Expected.Allow {
					t.Errorf("Allow = %q, want %q", got, *c.Expected.Allow)
				}
			}
			if string(body) != c.Expected.RawBody {
				t.Errorf("body:\n got %s\nwant %s", body, c.Expected.RawBody)
			}
		})
	}
}

func TestOpenAPIEmbeddedMatchesContract(t *testing.T) {
	want, err := os.ReadFile(contractOpenAPIPath)
	if err != nil {
		t.Fatalf("read %s: %v", contractOpenAPIPath, err)
	}
	if !bytes.Equal(openAPIDoc, want) {
		t.Fatalf("internal/httpapi/openapi.json differs from contract/openapi.json; copy it again")
	}
}
