package requestcontract

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"adomnia/internal/httpexec"
)

type KVRow struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

type Body struct {
	Type             string  `json:"type"`
	Raw              string  `json:"raw"`
	Form             []KVRow `json:"form"`
	GraphqlVariables string  `json:"graphqlVariables"`
}

type Auth struct {
	Type               string `json:"type"`
	Token              string `json:"token"`
	Username           string `json:"username"`
	Password           string `json:"password"`
	OAuth2GrantType    string `json:"oauth2GrantType,omitempty"`
	OAuth2TokenURL     string `json:"oauth2TokenUrl,omitempty"`
	OAuth2ClientID     string `json:"oauth2ClientId,omitempty"`
	OAuth2ClientSecret string `json:"oauth2ClientSecret,omitempty"`
	OAuth2Scope        string `json:"oauth2Scope,omitempty"`
	OAuth2RefreshToken string `json:"oauth2RefreshToken,omitempty"`
	AWSAccessKeyID     string `json:"awsAccessKeyId,omitempty"`
	AWSSecretKey       string `json:"awsSecretKey,omitempty"`
	AWSRegion          string `json:"awsRegion,omitempty"`
	AWSService         string `json:"awsService,omitempty"`
	AWSSessionToken    string `json:"awsSessionToken,omitempty"`
}

type Variable struct {
	Key     string `json:"key"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
	Secret  bool   `json:"secret,omitempty"`
}

type InheritancePolicy struct {
	Auth      string `json:"auth,omitempty"`
	Headers   string `json:"headers,omitempty"`
	Variables string `json:"variables,omitempty"`
	Scripts   string `json:"scripts,omitempty"`
}

type Scripts struct {
	Pre   string `json:"pre,omitempty"`
	Post  string `json:"post,omitempty"`
	Tests string `json:"tests,omitempty"`
}

type Assertion struct {
	Enabled    bool   `json:"enabled"`
	Target     string `json:"target"`
	Operator   string `json:"operator"`
	Expected   string `json:"expected"`
	HeaderName string `json:"headerName"`
}

type Request struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Type          string            `json:"type"`
	Method        string            `json:"method"`
	URL           string            `json:"url"`
	Params        []KVRow           `json:"params"`
	PathParams    []KVRow           `json:"pathParams"`
	Headers       []KVRow           `json:"headers"`
	Bodies        []Body            `json:"bodies"`
	ActiveBodyIdx int               `json:"activeBodyIdx"`
	Auth          Auth              `json:"auth"`
	Inheritance   InheritancePolicy `json:"inheritance,omitempty"`
	Timeout       int               `json:"timeout"`
	Follow        *bool             `json:"followRedirects"`
	Assertions    []Assertion       `json:"assertions"`
	Scripts       Scripts           `json:"scripts,omitempty"`
	OpenAPIPath   string            `json:"_openapiPath,omitempty"`
}

type Options struct {
	Vars        map[string]string
	DefaultTime int
}

type AssertionFailure struct {
	Message string
}

var varPattern = regexp.MustCompile(`\{\{([^}]+)\}\}`)
var pathParamPattern = regexp.MustCompile(`\{\{[^}]*\}\}|:([A-Za-z_][\w-]*)|\{([A-Za-z_][\w-]*)\}`)

func BuildHTTPPayload(req Request, opts Options) (httpexec.HTTPExecRequest, string, error) {
	vars := opts.Vars
	if vars == nil {
		vars = map[string]string{}
	}
	resolvedURL := applyPathParams(substVars(req.URL, vars), pathParamValues(req.PathParams, vars))
	if unresolved(resolvedURL) {
		return httpexec.HTTPExecRequest{}, "unresolved URL variables", nil
	}
	if resolvedURL == "" {
		return httpexec.HTTPExecRequest{}, "missing URL", nil
	}
	parsed, err := url.Parse(resolvedURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return httpexec.HTTPExecRequest{}, "", fmt.Errorf("invalid URL %q", req.URL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return httpexec.HTTPExecRequest{}, "only http and https URLs are supported by headless run", nil
	}
	query := parsed.Query()
	for _, row := range req.Params {
		if !row.Enabled || row.Key == "" {
			continue
		}
		key := substVars(row.Key, vars)
		value := substVars(row.Value, vars)
		if unresolved(key) || unresolved(value) {
			return httpexec.HTTPExecRequest{}, "unresolved query variables", nil
		}
		query.Set(key, value)
	}
	parsed.RawQuery = query.Encode()

	headers := map[string]string{}
	for _, row := range req.Headers {
		if !row.Enabled || row.Key == "" {
			continue
		}
		key := substVars(row.Key, vars)
		value := substVars(row.Value, vars)
		if unresolved(key) || unresolved(value) {
			return httpexec.HTTPExecRequest{}, "unresolved header variables", nil
		}
		headers[key] = value
	}
	body, contentType, skip := RequestBodyString(req, vars)
	if skip != "" {
		return httpexec.HTTPExecRequest{}, skip, nil
	}
	if contentType != "" && headerValue(headers, "Content-Type") == "" {
		headers["Content-Type"] = contentType
	}
	if skip := ApplyAuth(headers, req.Auth, vars); skip != "" {
		return httpexec.HTTPExecRequest{}, skip, nil
	}

	timeout := req.Timeout
	if timeout <= 0 {
		timeout = opts.DefaultTime
	}
	if timeout <= 0 {
		timeout = 30000
	}
	follow := true
	if req.Follow != nil {
		follow = *req.Follow
	}
	return httpexec.HTTPExecRequest{
		ID:              req.ID,
		Method:          strings.ToUpper(req.Method),
		URL:             parsed.String(),
		Headers:         headers,
		Body:            body,
		TimeoutMs:       timeout,
		FollowRedirects: follow,
		MaxRedirects:    10,
	}, "", nil
}

func RequestBodyString(req Request, vars map[string]string) (string, string, string) {
	if req.ActiveBodyIdx < 0 || req.ActiveBodyIdx >= len(req.Bodies) {
		return "", "", ""
	}
	body := req.Bodies[req.ActiveBodyIdx]
	switch body.Type {
	case "", "none":
		return "", "", ""
	case "raw":
		raw := substVars(body.Raw, vars)
		if unresolved(raw) {
			return "", "", "unresolved body variables"
		}
		return raw, "", ""
	case "urlencoded":
		values := url.Values{}
		for _, row := range body.Form {
			if !row.Enabled || row.Key == "" {
				continue
			}
			key := substVars(row.Key, vars)
			value := substVars(row.Value, vars)
			if unresolved(key) || unresolved(value) {
				return "", "", "unresolved form variables"
			}
			values.Set(key, value)
		}
		return values.Encode(), "application/x-www-form-urlencoded", ""
	case "formdata":
		var buffer bytes.Buffer
		writer := multipart.NewWriter(&buffer)
		for _, row := range body.Form {
			if !row.Enabled || row.Key == "" {
				continue
			}
			key := substVars(row.Key, vars)
			value := substVars(row.Value, vars)
			if unresolved(key) || unresolved(value) {
				return "", "", "unresolved form variables"
			}
			if strings.HasPrefix(value, "@file:") {
				path := strings.TrimSpace(strings.TrimPrefix(value, "@file:"))
				file, err := os.Open(path)
				if err != nil {
					return "", "", fmt.Sprintf("open multipart file %q: %v", path, err)
				}
				part, err := writer.CreateFormFile(key, filepath.Base(path))
				if err == nil {
					_, err = io.Copy(part, file)
				}
				_ = file.Close()
				if err != nil {
					return "", "", fmt.Sprintf("write multipart file %q: %v", path, err)
				}
			} else if err := writer.WriteField(key, value); err != nil {
				return "", "", fmt.Sprintf("write multipart field %q: %v", key, err)
			}
		}
		if err := writer.Close(); err != nil {
			return "", "", fmt.Sprintf("close multipart body: %v", err)
		}
		return buffer.String(), writer.FormDataContentType(), ""
	case "graphql":
		query := substVars(body.Raw, vars)
		variables := substVars(body.GraphqlVariables, vars)
		if unresolved(query) || unresolved(variables) {
			return "", "", "unresolved GraphQL variables"
		}
		payload := map[string]any{"query": query}
		if strings.TrimSpace(variables) != "" {
			payload["variables"] = json.RawMessage(variables)
		}
		data, err := json.Marshal(payload)
		if err != nil {
			return "", "", err.Error()
		}
		if bytes.Contains(data, []byte("{{")) {
			return "", "", "unresolved GraphQL variables"
		}
		return string(data), "application/json", ""
	default:
		return "", "", fmt.Sprintf("body type %q is not supported by headless run", body.Type)
	}
}

func ApplyAuth(headers map[string]string, auth Auth, vars map[string]string) string {
	switch auth.Type {
	case "", "none":
		return ""
	case "bearer":
		token := substVars(auth.Token, vars)
		if unresolved(token) {
			return "unresolved bearer token"
		}
		headers["Authorization"] = "Bearer " + token
	case "basic":
		user := substVars(auth.Username, vars)
		pass := substVars(auth.Password, vars)
		if unresolved(user) || unresolved(pass) {
			return "unresolved basic auth variables"
		}
		headers["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(user+":"+pass))
	case "apikey":
		name := substVars(auth.Username, vars)
		if name == "" {
			name = "X-API-Key"
		}
		token := substVars(auth.Token, vars)
		if unresolved(name) || unresolved(token) {
			return "unresolved API key variables"
		}
		headers[name] = token
	case "oauth2", "aws4":
		return fmt.Sprintf("auth type %q requires runner preparation", auth.Type)
	default:
		return fmt.Sprintf("auth type %q is not supported by headless run", auth.Type)
	}
	return ""
}

func EvaluateAssertions(assertions []Assertion, resp httpexec.HTTPExecResponse) string {
	for _, item := range assertions {
		if !item.Enabled {
			continue
		}
		actual, ok := assertionActual(item, resp)
		if !ok {
			continue
		}
		if !compare(item.Operator, actual, item.Expected) {
			return fmt.Sprintf("%s expected %s, got %s", item.Target, item.Expected, actual)
		}
	}
	return ""
}

func assertionActual(item Assertion, resp httpexec.HTTPExecResponse) (string, bool) {
	switch item.Target {
	case "statusCode":
		return strconv.Itoa(resp.Status), true
	case "responseTime":
		return strconv.FormatInt(resp.Ms, 10), true
	case "contentType":
		return resp.ContentType, true
	case "bodyText":
		return resp.Body, true
	case "header":
		if item.HeaderName == "" {
			return "", false
		}
		return headerValue(resp.Headers, item.HeaderName), true
	default:
		return "", false
	}
}

func compare(op, actual, expected string) bool {
	switch op {
	case "eq", "":
		return actual == expected
	case "neq":
		return actual != expected
	case "contains":
		return strings.Contains(actual, expected)
	case "not_contains":
		return !strings.Contains(actual, expected)
	case "gt", "lt", "gte", "lte":
		a, aErr := strconv.ParseFloat(actual, 64)
		e, eErr := strconv.ParseFloat(expected, 64)
		if aErr != nil || eErr != nil {
			return false
		}
		switch op {
		case "gt":
			return a > e
		case "lt":
			return a < e
		case "gte":
			return a >= e
		case "lte":
			return a <= e
		}
	case "exists":
		return actual != ""
	}
	return false
}

func substVars(text string, vars map[string]string) string {
	return varPattern.ReplaceAllStringFunc(text, func(match string) string {
		parts := varPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		key := strings.TrimSpace(parts[1])
		if value, ok := vars[key]; ok {
			return value
		}
		return "{{" + key + "}}"
	})
}

func SubstituteVars(text string, vars map[string]string) string {
	return substVars(text, vars)
}

func pathParamValues(rows []KVRow, vars map[string]string) map[string]string {
	out := map[string]string{}
	for _, row := range rows {
		if row.Enabled && row.Key != "" {
			out[row.Key] = substVars(row.Value, vars)
		}
	}
	return out
}

func applyPathParams(rawURL string, values map[string]string) string {
	return pathParamPattern.ReplaceAllStringFunc(rawURL, func(match string) string {
		parts := pathParamPattern.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		key := parts[1]
		if key == "" {
			key = parts[2]
		}
		if key == "" {
			return match
		}
		if value := values[key]; value != "" {
			return value
		}
		return match
	})
}

func unresolved(value string) bool {
	return strings.Contains(value, "{{")
}

func headerValue(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}
