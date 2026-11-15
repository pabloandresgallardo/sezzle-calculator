package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func portOf(t *testing.T, addr string) string {
	t.Helper()
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	return port
}

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestHealthcheckHealthy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/actuator/health" {
			http.NotFound(w, r)
			return
		}
		_, _ = io.WriteString(w, `{"status":"UP"}`)
	}))
	defer srv.Close()
	var stderr bytes.Buffer
	code := run([]string{"-healthcheck"}, env(map[string]string{"PORT": portOf(t, srv.Listener.Addr().String())}), &stderr)
	if code != 0 {
		t.Fatalf("exit = %d, want 0 (stderr %q)", code, stderr.String())
	}
}

func TestHealthcheckUnhealthyStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	var stderr bytes.Buffer
	if code := run([]string{"-healthcheck"}, env(map[string]string{"PORT": portOf(t, srv.Listener.Addr().String())}), &stderr); code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "503") {
		t.Errorf("stderr = %q, want the status", stderr.String())
	}
}

func TestHealthcheckServerDown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := portOf(t, ln.Addr().String())
	ln.Close() // nothing listens there now
	var stderr bytes.Buffer
	if code := run([]string{"-healthcheck"}, env(map[string]string{"PORT": port}), &stderr); code != 1 {
		t.Fatalf("exit = %d, want 1", code)
	}
}

func TestBadFlag(t *testing.T) {
	var stderr bytes.Buffer
	if code := run([]string{"-nope"}, env(nil), &stderr); code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
}

func TestDefaultPort(t *testing.T) {
	if got := listenAddr(env(nil)); got != ":8091" {
		t.Fatalf("listenAddr = %q, want :8091", got)
	}
	if got := listenAddr(env(map[string]string{"PORT": "9000"})); got != ":9000" {
		t.Fatalf("listenAddr = %q, want :9000", got)
	}
}

func TestServeAndShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serve(ctx, ln) }()

	url := "http://" + ln.Addr().String() + "/actuator/health"
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != `{"groups":["liveness","readiness"],"status":"UP"}` {
		t.Fatalf("health: %d %s", resp.StatusCode, body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve returned %v, want nil after shutdown", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not stop")
	}
}

func TestServerTimeouts(t *testing.T) {
	srv := newServer()
	checks := []struct {
		name      string
		got, want time.Duration
	}{
		{"ReadHeaderTimeout", srv.ReadHeaderTimeout, 10 * time.Second},
		{"ReadTimeout", srv.ReadTimeout, 30 * time.Second},
		{"WriteTimeout", srv.WriteTimeout, 30 * time.Second},
		{"IdleTimeout", srv.IdleTimeout, 120 * time.Second},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
	if srv.Handler == nil {
		t.Error("Handler is nil")
	}
}
