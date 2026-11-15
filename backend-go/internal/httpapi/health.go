package httpapi

import "net/http"

// Spring Boot actuator bodies (probes enabled, so the groups are listed).
var (
	healthBody = []byte(`{"groups":["liveness","readiness"],"status":"UP"}`)
	probeBody  = []byte(`{"status":"UP"}`)
)

// healthHandler serves a fixed UP body. The Content-Type is the actuator v3
// type unless the client asks for application/json and not for the
// actuator type itself.
func healthHandler(body []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeBody(w, http.StatusOK, healthContentType(r.Header.Values("Accept")), body)
	}
}

func healthContentType(accept []string) string {
	types, _ := parseAccept(accept)
	wantsJSON := false
	for _, m := range types {
		if m.typ == "application" && m.sub == "vnd.spring-boot.actuator.v3+json" {
			return contentTypeActuator
		}
		if m.typ == "application" && m.sub == "json" {
			wantsJSON = true
		}
	}
	if wantsJSON {
		return contentTypeJSON
	}
	return contentTypeActuator
}
