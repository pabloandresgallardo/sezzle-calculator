package httpapi

import (
	"strconv"
	"strings"
)

// mediaType is a parsed MIME type, following Spring's MimeTypeUtils /
// MediaType rules closely enough for the contract: type and subtype are
// lowercased, parameters keep their spelling and order.
type mediaType struct {
	typ, sub string
	params   []mediaParam
}

type mediaParam struct{ name, value string }

// String renders like Spring's MimeType.toString: "type/sub;name=value".
func (m mediaType) String() string {
	var b strings.Builder
	b.WriteString(m.typ)
	b.WriteByte('/')
	b.WriteString(m.sub)
	for _, p := range m.params {
		b.WriteByte(';')
		b.WriteString(p.name)
		b.WriteByte('=')
		b.WriteString(p.value)
	}
	return b.String()
}

// knownCharsets approximates java.nio.charset.Charset.isSupported for the
// names a client may plausibly send. A charset outside it makes the media
// type unparseable, like Spring's InvalidMimeTypeException. Non-UTF-8
// bodies are still decoded as UTF-8 (Tier B, not replicated).
var knownCharsets = map[string]bool{
	"utf-8": true, "utf8": true, "us-ascii": true, "ascii": true,
	"iso-8859-1": true, "iso8859-1": true, "latin1": true, "iso-8859-15": true,
	"utf-16": true, "utf-16be": true, "utf-16le": true,
	"utf-32": true, "utf-32be": true, "utf-32le": true,
	"windows-1252": true, "cp1252": true,
}

// parseMediaType parses one media type. ok is false when Spring would throw
// InvalidMimeTypeException (no '/', empty or non-token type/subtype, a
// wildcard type with a concrete subtype, an unknown charset, a bad token
// or unterminated quoted value, or with isAccept an invalid q).
func parseMediaType(s string, isAccept bool) (m mediaType, ok bool) {
	parts := splitQuoted(s, ';')
	full := strings.TrimSpace(parts[0])
	if full == "*" {
		full = "*/*"
	}
	typ, sub, found := strings.Cut(full, "/")
	if !found || !isToken(typ) || !isToken(sub) {
		return mediaType{}, false
	}
	m.typ, m.sub = strings.ToLower(typ), strings.ToLower(sub)
	if m.typ == "*" && m.sub != "*" {
		return mediaType{}, false
	}
	for _, raw := range parts[1:] {
		raw = strings.TrimSpace(raw)
		name, value, hasEq := strings.Cut(raw, "=")
		if !hasEq {
			continue // Spring ignores parameters without '='.
		}
		name, value = strings.TrimSpace(name), strings.TrimSpace(value)
		if !isToken(name) || !validParamValue(value) {
			return mediaType{}, false
		}
		switch {
		case strings.EqualFold(name, "charset"):
			if !knownCharsets[strings.ToLower(unquote(value))] {
				return mediaType{}, false
			}
		case isAccept && strings.EqualFold(name, "q"):
			q, err := strconv.ParseFloat(unquote(value), 64)
			if err != nil || q < 0 || q > 1 {
				return mediaType{}, false
			}
		}
		m.params = append(m.params, mediaParam{name: name, value: value})
	}
	return m, true
}

// parseAccept parses a comma-separated Accept value. Empty entries are
// skipped; ok is false when any entry is invalid.
func parseAccept(values []string) (types []mediaType, ok bool) {
	for _, v := range values {
		for _, entry := range splitQuoted(v, ',') {
			if strings.TrimSpace(entry) == "" {
				continue
			}
			m, ok := parseMediaType(entry, true)
			if !ok {
				return nil, false
			}
			types = append(types, m)
		}
	}
	return types, true
}

// splitQuoted splits s on sep outside double-quoted strings.
func splitQuoted(s string, sep byte) []string {
	var parts []string
	inQuotes, escaped, start := false, false, 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case escaped:
			escaped = false
		case c == '\\' && inQuotes:
			escaped = true
		case c == '"':
			inQuotes = !inQuotes
		case c == sep && !inQuotes:
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	return append(parts, s[start:])
}

// isToken reports whether s is a non-empty RFC 7230 token.
func isToken(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c <= 0x20 || c >= 0x7F || strings.IndexByte(`()<>@,;:\"/[]?={}`, c) >= 0 {
			return false
		}
	}
	return true
}

func isQuoted(s string) bool {
	return len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"'
}

func validParamValue(v string) bool {
	if isQuoted(v) {
		return true
	}
	return isToken(v)
}

func unquote(v string) string {
	if isQuoted(v) {
		return v[1 : len(v)-1]
	}
	return v
}
