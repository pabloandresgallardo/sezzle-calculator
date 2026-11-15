package httpapi

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
)

// openAPIDoc is a byte-exact copy of contract/openapi.json (Java's
// /v3/api-docs without "servers"); TestOpenAPIEmbeddedMatchesContract keeps
// it in sync.
//
//go:embed openapi.json
var openAPIDoc []byte

//go:embed swagger.html
var swaggerHTML []byte

// springdocKeyOrder is the top-level member order of springdoc's output;
// "servers" is inserted after "info". Other keys follow, sorted.
var springdocKeyOrder = []string{"openapi", "info", "servers", "paths", "components"}

func serveOpenAPI(w http.ResponseWriter, r *http.Request) {
	doc, err := openAPIWithServer(openAPIDoc, r.Host)
	if err != nil {
		writeProblem(w, r, http.StatusInternalServerError, "Internal error", internalErrorDetail)
		return
	}
	writeBody(w, http.StatusOK, contentTypeJSON, doc)
}

// openAPIWithServer returns doc compacted, with springdoc's generated
// servers entry built from the request host, like
// {"url":"http://localhost:8091","description":"Generated server url"}.
func openAPIWithServer(doc []byte, host string) ([]byte, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(doc, &members); err != nil || members == nil {
		return nil, errors.New("openapi: document is not a JSON object")
	}
	server := appendJSONString([]byte(`[{"url":`), "http://"+host)
	members["servers"] = append(server, `,"description":"Generated server url"}]`...)

	keys := make([]string, 0, len(members))
	seen := map[string]bool{}
	for _, k := range springdocKeyOrder {
		if _, ok := members[k]; ok {
			keys = append(keys, k)
			seen[k] = true
		}
	}
	var rest []string
	for k := range members {
		if !seen[k] {
			rest = append(rest, k)
		}
	}
	sort.Strings(rest)
	keys = append(keys, rest...)

	var out bytes.Buffer
	out.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		out.Write(appendJSONString(nil, k))
		out.WriteByte(':')
		// Compact keeps '<', '>' and '&' raw (no HTML escaping).
		if err := json.Compact(&out, members[k]); err != nil {
			return nil, err
		}
	}
	out.WriteByte('}')
	return out.Bytes(), nil
}

func redirectSwagger(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Location", "/swagger-ui/index.html")
	w.Header().Set("Content-Length", "0")
	w.WriteHeader(http.StatusFound)
}

func serveSwaggerUI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeBody(w, http.StatusOK, "text/html", swaggerHTML)
}
