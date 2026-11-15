package httpapi

import (
	"errors"
	"strings"
	"testing"
)

const okBody = `{"operation":"add","operands":[1,2]}`

// decodeOK asserts body decodes and returns the operation and the operands
// rendered with PlainString.
func decodeOK(t *testing.T, body string) (string, []string) {
	t.Helper()
	cmd, err := decodeCommand([]byte(body))
	if err != nil {
		t.Fatalf("decodeCommand(%q) error = %v, want success", body, err)
	}
	ops := make([]string, len(cmd.Operands))
	for i, d := range cmd.Operands {
		ops[i] = d.PlainString()
	}
	return cmd.Operation, ops
}

func decodeDetail(t *testing.T, body string) string {
	t.Helper()
	_, err := decodeCommand([]byte(body))
	if err == nil {
		t.Fatalf("decodeCommand(%q) succeeded, want error", body)
	}
	var me *malformedError
	if !errors.As(err, &me) {
		t.Fatalf("decodeCommand(%q) error type %T, want *malformedError", body, err)
	}
	if me.Error() != me.detail {
		t.Fatalf("Error() = %q, want detail %q", me.Error(), me.detail)
	}
	return me.detail
}

// Reference §2.3 and §2.4: every body that must give the constant detail.
func TestDecodeShapeErrors(t *testing.T) {
	deep := `{"operation":"add","operands":[1,2],"foo":` + strings.Repeat("[", 600) + strings.Repeat("]", 600) + `}`
	bodies := map[string]string{
		"empty":                        ``,
		"whitespace only":              " \n\t ",
		"null":                         `null`,
		"empty array":                  `[]`,
		"array of object":              `[` + okBody + `]`,
		"number":                       `5`,
		"string":                       `"add"`,
		"boolean":                      `true`,
		"trailing word":                okBody + ` x`,
		"trailing object":              okBody + `{}`,
		"trailing object spaced":       okBody + ` {"a":1}`,
		"trailing bracket":             okBody + `]`,
		"trailing comma object":        `{"operation":"add","operands":[1,2],}`,
		"trailing comma array":         `{"operation":"add","operands":[1,2,]}`,
		"single quotes":                `{'operation':'add','operands':[1,2]}`,
		"unquoted keys":                `{operation:"add",operands:[1,2]}`,
		"line comment":                 `{"operation":"add",//c` + "\n" + `"operands":[1,2]}`,
		"block comment":                `{"operation":"add",/*c*/"operands":[1,2]}`,
		"raw tab in string":            "{\"operation\":\"a\tdd\",\"operands\":[1,2]}",
		"invalid escape":               `{"operation":"\x","operands":[1,2]}`,
		"broken":                       `{"operation":"add","operands":[1,2`,
		"later duplicate wrong type":   `{"operation":"add","operands":[1,2],"operation":5}`,
		"earlier duplicate wrong type": `{"operation":5,"operation":"add","operands":[1,2]}`,
		"earlier operands bad":         `{"operation":"add","operands":["1"],"operands":[1,2]}`,
		"unknown field":                `{"operation":"add","operands":[1,2],"foo":1}`,
		"unknown null field":           `{"operation":"add","operands":[1,2],"foo":null}`,
		"unknown nested 600 deep":      deep,
		"case-variant key":             `{"Operation":"add","operands":[1,2]}`,
		"invalid utf-8":                "{\"operation\":\"\xE1dd\",\"operands\":[1,2]}",
		"operation number":             `{"operation":5,"operands":[1,2]}`,
		"operation float":              `{"operation":5.5,"operands":[1,2]}`,
		"operation boolean":            `{"operation":true,"operands":[1,2]}`,
		"operation array":              `{"operation":["add"],"operands":[1,2]}`,
		"operation empty array":        `{"operation":[],"operands":[1,2]}`,
		"operation object":             `{"operation":{},"operands":[1,2]}`,
		"operands number":              `{"operation":"add","operands":1}`,
		"operands string":              `{"operation":"add","operands":"1,2"}`,
		"operands empty string":        `{"operation":"add","operands":""}`,
		"operands object":              `{"operation":"add","operands":{}}`,
		"operands boolean":             `{"operation":"add","operands":true}`,
		"operand string number":        `{"operation":"add","operands":["1",2]}`,
		"operand textual null":         `{"operation":"add","operands":["null",2]}`,
		"operand nbsp string":          `{"operation":"add","operands":[" ",2]}`,
		"operand true":                 `{"operation":"add","operands":[true,2]}`,
		"operand object":               `{"operation":"add","operands":[{},2]}`,
		"operand array":                `{"operation":"add","operands":[[1],2]}`,
		"operand empty array":          `{"operation":"add","operands":[[],2]}`,
		"leading zero":                 `{"operation":"add","operands":[01,2]}`,
		"plus sign":                    `{"operation":"add","operands":[+1,2]}`,
		"leading dot":                  `{"operation":"add","operands":[.5,2]}`,
		"trailing dot":                 `{"operation":"add","operands":[5.,2]}`,
		"NaN":                          `{"operation":"add","operands":[NaN,2]}`,
		"hex":                          `{"operation":"add","operands":[0x10,2]}`,
		"dangling exponent":            `{"operation":"add","operands":[1e,2]}`,
		"1001 int digits":              `{"operation":"add","operands":[1` + strings.Repeat("0", 1000) + `,1]}`,
		"1001 float digits":            `{"operation":"add","operands":[1.` + strings.Repeat("0", 1000) + `,1]}`,
		"scale overflow":               `{"operation":"add","operands":[1e-2147483648,1]}`,
		"negative scale overflow":      `{"operation":"add","operands":[1e2147483648,1]}`,
		"shape error beats null":       `{"operation":null,"operands":[null,"1"]}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			if got := decodeDetail(t, body); got != shapeDetail {
				t.Errorf("detail = %q, want the constant shape detail", got)
			}
		})
	}
}

func TestDecodeNullDetails(t *testing.T) {
	cases := []struct{ name, body, want string }{
		{"empty object", `{}`, "operands must not be null; operation must not be null"},
		{"missing operands", `{"operation":"add"}`, "operands must not be null"},
		{"missing operation", `{"operands":[1,2]}`, "operation must not be null"},
		{"null operation", `{"operation":null,"operands":[1,2]}`, "operation must not be null"},
		{"both null", `{"operation":null,"operands":null}`, "operands must not be null; operation must not be null"},
		{"null op and operand", `{"operation":null,"operands":[null]}`, "operands[0] must not be null; operation must not be null"},
		{"null beats unknown op", `{"operation":"nope","operands":[null]}`, "operands[0] must not be null"},
		{"sorted as strings", `{"operation":"add","operands":[1,1,null,1,1,1,1,1,1,1,null]}`, "operands[10] must not be null; operands[2] must not be null"},
		{"empty string operand", `{"operation":"add","operands":["",1]}`, "operands[0] must not be null"},
		{"blank string operand", `{"operation":"add","operands":[1," "]}`, "operands[1] must not be null"},
		{"escaped blank operand", `{"operation":"add","operands":["\t\n\u0001 ",1]}`, "operands[0] must not be null"},
		{"later operands null", `{"operation":"add","operands":[1,2],"operands":null}`, "operands must not be null"},
		{"earlier null replaced", `{"operation":null,"operation":"add"}`, "operands must not be null"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := decodeDetail(t, c.body); got != c.want {
				t.Errorf("detail = %q, want %q", got, c.want)
			}
		})
	}
}

func TestDecodeAccepted(t *testing.T) {
	cases := []struct {
		name, body, op string
		operands       []string
	}{
		{"plain", okBody, "add", []string{"1", "2"}},
		{"BOM", "\uFEFF" + okBody, "add", []string{"1", "2"}},
		{"trailing newlines", okBody + "\n\n", "add", []string{"1", "2"}},
		{"leading whitespace and spaces", "\n\t { \"operation\" : \"add\" , \"operands\" : [ 1 , 2 ] } ", "add", []string{"1", "2"}},
		{"duplicate operation last wins", `{"operation":"subtract","operation":"add","operands":[1,2]}`, "add", []string{"1", "2"}},
		{"duplicate operands last wins", `{"operation":"add","operands":[1,2],"operands":[5,5]}`, "add", []string{"5", "5"}},
		{"earlier null operand replaced", `{"operation":"add","operands":[null],"operands":[1,2]}`, "add", []string{"1", "2"}},
		{"escaped operation", `{"operation":"add","operands":[1,2]}`, "add", []string{"1", "2"}},
		{"escaped key", `{"operation":"add","operands":[1,2]}`, "add", []string{"1", "2"}},
		{"raw DEL kept", "{\"operation\":\"a\x7fb\",\"operands\":[1,2]}", "a\x7fb", []string{"1", "2"}},
		{"empty operation", `{"operation":"","operands":[1,2]}`, "", []string{"1", "2"}},
		{"spaced operation", `{"operation":" add","operands":[1,2]}`, " add", []string{"1", "2"}},
		{"no operands", `{"operation":"add","operands":[]}`, "add", []string{}},
		{"exponent forms", `{"operation":"add","operands":[1E+3,1e-3,-0,1e00000000002]}`, "add", []string{"1000", "0.001", "0", "100"}},
		{"1000 int digits", `{"operation":"add","operands":[1` + strings.Repeat("0", 999) + `]}`, "add", []string{"1" + strings.Repeat("0", 999)}},
		{"huge exponent kept lazy", `{"operation":"add","operands":[0e-999999999]}`, "add", []string{"0"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			op, operands := decodeOK(t, c.body)
			if op != c.op {
				t.Errorf("operation = %q, want %q", op, c.op)
			}
			if strings.Join(operands, ",") != strings.Join(c.operands, ",") || len(operands) != len(c.operands) {
				t.Errorf("operands = %v, want %v", operands, c.operands)
			}
		})
	}
}

func TestIsBlank(t *testing.T) {
	for s, want := range map[string]bool{"": true, " ": true, "\t\r\n": true, "\x00\x1f ": true, "a": false, " 1 ": false, " ": false, "\u2028": false} {
		if got := isBlank(s); got != want {
			t.Errorf("isBlank(%q) = %v, want %v", s, got, want)
		}
	}
}
