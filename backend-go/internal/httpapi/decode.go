package httpapi

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/app"
	"github.com/pabloandresgallardo/sezzle-calculator/backend-go/internal/decimal"
)

// shapeDetail is the constant detail of every syntax, type, unknown-field or
// number-limit error (Java ProblemDetailHandler).
const shapeDetail = "Request body is not valid JSON or does not match the expected shape"

// malformedError is a 400 "Malformed request". detail is either shapeDetail
// or the sorted "; "-joined list of "<field> must not be null".
type malformedError struct {
	detail string
}

func (e *malformedError) Error() string { return e.detail }

var (
	errShape = &malformedError{detail: shapeDetail}
	utf8BOM  = []byte{0xEF, 0xBB, 0xBF}
)

// decodeCommand parses a calculate body with the Java (Jackson 3 + Bean
// Validation) rules:
//   - a leading UTF-8 BOM is skipped; invalid UTF-8, syntax errors and
//     trailing tokens are shape errors;
//   - the body must be an object with only the exact (case-sensitive) keys
//     "operation" and "operands"; members are bound in order, so a later
//     duplicate replaces an earlier one, but a type error in any of them
//     fails (Jackson binds as it streams);
//   - operation is a string or null; operands is null or an array whose
//     items are numbers, null, or empty/blank strings (coerced to null);
//   - only when the shape is valid, null or missing fields are reported,
//     sorted lexicographically and joined with "; ".
//
// The operation code is not looked up here: null checks run before it.
func decodeCommand(body []byte) (app.Command, error) {
	body = bytes.TrimPrefix(body, utf8BOM)
	// json.Valid rejects trailing tokens; it does not check UTF-8.
	if !utf8.Valid(body) || !json.Valid(body) {
		return app.Command{}, errShape
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return app.Command{}, errShape
	}

	var (
		operation    *string
		operands     []decimal.Decimal
		operandsSet  bool
		nullOperands []int
	)
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return app.Command{}, errShape
		}
		key, _ := tok.(string)
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return app.Command{}, errShape
		}
		switch key {
		case "operation":
			op, err := decodeOperation(raw)
			if err != nil {
				return app.Command{}, err
			}
			operation = op
		case "operands":
			ops, nulls, set, err := decodeOperands(raw)
			if err != nil {
				return app.Command{}, err
			}
			operands, nullOperands, operandsSet = ops, nulls, set
		default:
			return app.Command{}, errShape
		}
	}

	var violations []string
	if operation == nil {
		violations = append(violations, "operation must not be null")
	}
	if !operandsSet {
		violations = append(violations, "operands must not be null")
	}
	for _, i := range nullOperands {
		violations = append(violations, "operands["+strconv.Itoa(i)+"] must not be null")
	}
	if len(violations) > 0 {
		sort.Strings(violations)
		return app.Command{}, &malformedError{detail: strings.Join(violations, "; ")}
	}
	return app.Command{Operation: *operation, Operands: operands}, nil
}

// decodeOperation returns nil for JSON null. Any non-string is a shape error
// (Jackson's textual coercion from numbers and booleans is disabled).
func decodeOperation(raw json.RawMessage) (*string, error) {
	switch raw[0] {
	case 'n':
		return nil, nil
	case '"':
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return nil, errShape
		}
		return &s, nil
	default:
		return nil, errShape
	}
}

// decodeOperands returns set=false for JSON null, and the indexes of the null
// items (null, "" or a blank string).
func decodeOperands(raw json.RawMessage) (ops []decimal.Decimal, nulls []int, set bool, err error) {
	switch raw[0] {
	case 'n':
		return nil, nil, false, nil
	case '[':
	default:
		return nil, nil, false, errShape
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, nil, false, errShape
	}
	ops = make([]decimal.Decimal, len(items))
	for i, item := range items {
		switch c := item[0]; {
		case c == 'n':
			nulls = append(nulls, i)
		case c == '"':
			var s string
			if err := json.Unmarshal(item, &s); err != nil || !isBlank(s) {
				// A non-blank string is never coerced to a number.
				return nil, nil, false, errShape
			}
			nulls = append(nulls, i)
		case c == '-' || (c >= '0' && c <= '9'):
			d, err := decimal.Parse(string(item))
			if err != nil {
				return nil, nil, false, errShape
			}
			ops[i] = d
		default:
			return nil, nil, false, errShape
		}
	}
	return ops, nulls, true, nil
}

// isBlank is Jackson's StdDeserializer._isBlank: every char is <= U+0020.
// (Bytes suffice: every byte of a multi-byte UTF-8 sequence is >= 0x80.)
func isBlank(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] > 0x20 {
			return false
		}
	}
	return true
}
