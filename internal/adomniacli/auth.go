package adomniacli

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"adomnia/internal/httpexec"
	"adomnia/internal/requestcontract"
)

func prepareHeadlessAuth(req requestcontract.Request, vars map[string]string) (requestcontract.Request, error) {
	switch req.Auth.Type {
	case "oauth2":
		token, err := fetchOAuth2Token(req.Auth, vars)
		if err != nil {
			return req, err
		}
		req.Auth = requestcontract.Auth{Type: "bearer", Token: token}
	case "aws4":
		// Signing happens after the final URL, headers, and body are resolved.
		req.Auth.Type = "none"
	}
	return req, nil
}

func fetchOAuth2Token(auth requestcontract.Auth, vars map[string]string) (string, error) {
	grant := strings.TrimSpace(auth.OAuth2GrantType)
	if grant == "" {
		grant = "client_credentials"
	}
	if grant == "authorization_code_pkce" || grant == "authorization_code" {
		return "", fmt.Errorf("OAuth2 interactive authorization is not available headless; provide a refresh token or use client_credentials")
	}
	tokenURL := requestcontract.SubstituteVars(auth.OAuth2TokenURL, vars)
	if tokenURL == "" {
		return "", fmt.Errorf("OAuth2 token URL is required")
	}
	values := url.Values{"grant_type": []string{grant}}
	add := func(key, value string) {
		if resolved := requestcontract.SubstituteVars(value, vars); resolved != "" {
			values.Set(key, resolved)
		}
	}
	add("client_id", auth.OAuth2ClientID)
	add("client_secret", auth.OAuth2ClientSecret)
	if grant != "refresh_token" {
		add("scope", auth.OAuth2Scope)
	}
	switch grant {
	case "client_credentials":
	case "password":
		add("username", auth.Username)
		add("password", auth.Password)
	case "refresh_token":
		add("refresh_token", auth.OAuth2RefreshToken)
		if values.Get("refresh_token") == "" {
			return "", fmt.Errorf("OAuth2 refresh token is required")
		}
	default:
		return "", fmt.Errorf("OAuth2 grant %q is not supported headless", grant)
	}
	raw := httpexec.Execute(mustJSON(httpexec.HTTPExecRequest{
		Method: "POST", URL: tokenURL, Headers: map[string]string{"Content-Type": "application/x-www-form-urlencoded"},
		Body: values.Encode(), TimeoutMs: 15000, FollowRedirects: true,
	}))
	var response httpexec.HTTPExecResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return "", fmt.Errorf("decode OAuth2 response: %w", err)
	}
	if response.Error != nil {
		return "", fmt.Errorf("OAuth2 token request: %s", response.Error.Message)
	}
	var body struct {
		AccessToken      string `json:"access_token"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	if err := json.Unmarshal([]byte(response.Body), &body); err != nil {
		return "", fmt.Errorf("decode OAuth2 token body: %w", err)
	}
	if body.AccessToken == "" {
		message := body.ErrorDescription
		if message == "" {
			message = body.Error
		}
		if message == "" {
			message = "token endpoint returned no access_token"
		}
		return "", fmt.Errorf("OAuth2 token request: %s", message)
	}
	return body.AccessToken, nil
}

func applyAWS4(payload *httpexec.HTTPExecRequest, auth requestcontract.Auth, vars map[string]string, now time.Time) error {
	accessKey := requestcontract.SubstituteVars(auth.AWSAccessKeyID, vars)
	secretKey := requestcontract.SubstituteVars(auth.AWSSecretKey, vars)
	if accessKey == "" || secretKey == "" {
		return fmt.Errorf("AWS4 access key and secret key are required")
	}
	region := requestcontract.SubstituteVars(auth.AWSRegion, vars)
	if region == "" {
		region = "us-east-1"
	}
	service := requestcontract.SubstituteVars(auth.AWSService, vars)
	if service == "" {
		service = "execute-api"
	}
	parsed, err := url.Parse(payload.URL)
	if err != nil {
		return fmt.Errorf("AWS4 URL: %w", err)
	}
	dateTime := now.UTC().Format("20060102T150405Z")
	dateOnly := now.UTC().Format("20060102")
	payloadHash := sha256Hex(payload.Body)
	payload.Headers["host"] = parsed.Host
	payload.Headers["x-amz-date"] = dateTime
	payload.Headers["x-amz-content-sha256"] = payloadHash
	if token := requestcontract.SubstituteVars(auth.AWSSessionToken, vars); token != "" {
		payload.Headers["x-amz-security-token"] = token
	}
	headerNames := make([]string, 0, len(payload.Headers))
	lowerValues := map[string]string{}
	for key, value := range payload.Headers {
		lower := strings.ToLower(key)
		headerNames = append(headerNames, lower)
		lowerValues[lower] = strings.TrimSpace(value)
	}
	sort.Strings(headerNames)
	headerNames = uniqueStrings(headerNames)
	var canonicalHeaders strings.Builder
	for _, key := range headerNames {
		fmt.Fprintf(&canonicalHeaders, "%s:%s\n", key, lowerValues[key])
	}
	canonicalRequest := strings.Join([]string{strings.ToUpper(payload.Method), escapedPath(parsed), canonicalQuery(parsed.Query()), canonicalHeaders.String(), strings.Join(headerNames, ";"), payloadHash}, "\n")
	scope := dateOnly + "/" + region + "/" + service + "/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + dateTime + "\n" + scope + "\n" + sha256Hex(canonicalRequest)
	key := hmacBytes([]byte("AWS4"+secretKey), dateOnly)
	key = hmacBytes(key, region)
	key = hmacBytes(key, service)
	key = hmacBytes(key, "aws4_request")
	signature := hex.EncodeToString(hmacBytes(key, stringToSign))
	payload.Headers["Authorization"] = "AWS4-HMAC-SHA256 Credential=" + accessKey + "/" + scope + ", SignedHeaders=" + strings.Join(headerNames, ";") + ", Signature=" + signature
	return nil
}

func resolveVaultVars(vars map[string]string) (map[string]string, error) {
	out := make(map[string]string, len(vars))
	for key, value := range vars {
		if !strings.HasPrefix(strings.TrimSpace(value), "vault:") {
			out[key] = value
			continue
		}
		envKey := "ADOMNIA_VAULT_" + normalizeSecretKey(key)
		resolved, ok := os.LookupEnv(envKey)
		if !ok {
			return nil, fmt.Errorf("variable %q is a Vault reference; set %s for headless execution", key, envKey)
		}
		out[key] = resolved
	}
	return out, nil
}

func normalizeSecretKey(value string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(value) {
		if r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	return strings.Trim(b.String(), "_")
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func hmacBytes(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}
func escapedPath(value *url.URL) string {
	if value.EscapedPath() == "" {
		return "/"
	}
	return value.EscapedPath()
}
func canonicalQuery(values url.Values) string {
	pairs := []string{}
	for key, items := range values {
		if len(items) == 0 {
			items = []string{""}
		}
		for _, value := range items {
			pairs = append(pairs, awsEscape(key)+"="+awsEscape(value))
		}
	}
	sort.Strings(pairs)
	return strings.Join(pairs, "&")
}
func awsEscape(value string) string { return strings.ReplaceAll(url.QueryEscape(value), "+", "%20") }
func uniqueStrings(values []string) []string {
	out := values[:0]
	for _, value := range values {
		if len(out) == 0 || out[len(out)-1] != value {
			out = append(out, value)
		}
	}
	return out
}
