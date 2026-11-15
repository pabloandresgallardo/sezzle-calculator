package httpapi

import "testing"

// Reference §3.3: output escaping follows Jackson, not encoding/json.
func TestAppendJSONString(t *testing.T) {
	cases := map[string]string{
		"a\tb\nc\rd\be\ff\u0001g\u001fh\u007fi\u2028j\u2029k/l\\m": "\"a\\tb\\nc\\rd\\be\\ff\\u0001g\\u001Fh\u007fi\u2028j\u2029k/l\\\\m\"",
		`<script>&'"`: `"<script>&'\""`,
		"add\x00":     `"add\u0000"`,
		"😀…á":         `"😀…á"`,
		"":            `""`,
	}
	for in, want := range cases {
		if got := string(appendJSONString(nil, in)); got != want {
			t.Errorf("appendJSONString(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestProblemBody(t *testing.T) {
	got := string(problemBody(400, "Division by zero", "division by zero", "/api/v1/calculate"))
	want := `{"detail":"division by zero","instance":"/api/v1/calculate","status":400,"title":"Division by zero"}`
	if got != want {
		t.Fatalf("got %s", got)
	}
}
