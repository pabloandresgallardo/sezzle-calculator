// Command server runs the calculator HTTP API.
//
// It listens on :$PORT (default 8091). With -healthcheck it instead GETs
// http://127.0.0.1:$PORT/actuator/health and exits 0 when the answer is 200,
// 1 otherwise; the Docker Compose healthcheck uses it because the image has
// no shell or curl.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/httpapi"
)

const defaultPort = "8091"

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stderr))
}

func run(args []string, getenv func(string) string, stderr io.Writer) int {
	fs := flag.NewFlagSet("server", flag.ContinueOnError)
	fs.SetOutput(stderr)
	healthcheck := fs.Bool("healthcheck", false, "probe /actuator/health on 127.0.0.1:$PORT and exit 0 (healthy) or 1")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	addr := listenAddr(getenv)
	if *healthcheck {
		return probe("http://127.0.0.1"+addr+"/actuator/health", stderr)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintln(stderr, "listen:", err)
		return 1
	}
	log.Printf("listening on %s", addr)
	if err := serve(ctx, ln); err != nil {
		fmt.Fprintln(stderr, "serve:", err)
		return 1
	}
	return 0
}

func listenAddr(getenv func(string) string) string {
	port := getenv("PORT")
	if port == "" {
		port = defaultPort
	}
	return ":" + port
}

// newServer returns the API server with timeouts that bound slow clients;
// a real calculation takes milliseconds and nginx caps bodies at 1 MB.
func newServer() *http.Server {
	return &http.Server{
		Handler:           httpapi.NewHandler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// serve runs the API on ln until ctx is done, then shuts down gracefully.
func serve(ctx context.Context, ln net.Listener) error {
	srv := newServer()
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func probe(url string, stderr io.Writer) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		fmt.Fprintln(stderr, "healthcheck:", err)
		return 1
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(stderr, "healthcheck: status", resp.StatusCode)
		return 1
	}
	return 0
}
