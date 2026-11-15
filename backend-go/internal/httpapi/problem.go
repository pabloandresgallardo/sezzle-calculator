package httpapi

import (
	"net/http"
	"strconv"
	"strings"
)

// Exact Content-Type values of the Java backend (reference §6).
const (
	contentTypeJSON     = "application/json"
	contentTypeProblem  = "application/problem+json"
	contentTypeActuator = "application/vnd.spring-boot.actuator.v3+json"
)

// problemBody renders a ProblemDetail like Spring + Jackson 3: keys sorted
// alphabetically (detail, instance, status, title), no "type", no spaces.
func problemBody(status int, title, detail, instance string) []byte {
	b := make([]byte, 0, 96+len(detail)+len(instance))
	b = append(b, `{"detail":`...)
	b = appendJSONString(b, detail)
	b = append(b, `,"instance":`...)
	b = appendJSONString(b, instance)
	b = append(b, `,"status":`...)
	b = strconv.AppendInt(b, int64(status), 10)
	b = append(b, `,"title":`...)
	b = appendJSONString(b, title)
	return append(b, '}')
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, title, detail string) {
	writeBody(w, status, contentTypeProblem, problemBody(status, title, detail, instancePath(r)))
}

func writeBody(w http.ResponseWriter, status int, contentType string, body []byte) {
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// instancePath is the raw request path (percent-encoding kept, query
// dropped), which is what Spring puts in ProblemDetail.instance.
func instancePath(r *http.Request) string {
	uri := r.RequestURI
	if strings.HasPrefix(uri, "/") {
		path, _, _ := strings.Cut(uri, "?")
		return path
	}
	return r.URL.EscapedPath()
}

const hexDigits = "0123456789ABCDEF"

// appendJSONString appends s as a JSON string with Jackson's escaping:
// only '"', '\\' and control characters are escaped; \t \n \r \b \f use
// short forms and the other controls \u00XX with uppercase hex. '<', '>',
// '&', '/', DEL, U+2028 and U+2029 stay raw (encoding/json would escape
// U+2028/U+2029 and use lowercase hex).
func appendJSONString(b []byte, s string) []byte {
	b = append(b, '"')
	start := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 0x20 && c != '"' && c != '\\' {
			continue
		}
		b = append(b, s[start:i]...)
		switch c {
		case '"':
			b = append(b, '\\', '"')
		case '\\':
			b = append(b, '\\', '\\')
		case '\t':
			b = append(b, '\\', 't')
		case '\n':
			b = append(b, '\\', 'n')
		case '\r':
			b = append(b, '\\', 'r')
		case '\b':
			b = append(b, '\\', 'b')
		case '\f':
			b = append(b, '\\', 'f')
		default:
			b = append(b, '\\', 'u', '0', '0', hexDigits[c>>4], hexDigits[c&0xF])
		}
		start = i + 1
	}
	b = append(b, s[start:]...)
	return append(b, '"')
}
