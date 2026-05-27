// templates.go — Local template marketplace for adOmnia.
// Templates are pre-made request collections, flows, or mock configurations
// that users can browse, install, and share.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	bolt "go.etcd.io/bbolt"
)

// Template represents a reusable template for requests, collections, flows, etc.
type Template struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Author      string   `json:"author"`
	Version     string   `json:"version"`
	Category    string   `json:"category"`
	Tags        []string `json:"tags"`
	Content     string   `json:"content"`
	Icon        string   `json:"icon"`
	Downloads   int      `json:"downloads"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

// TemplateCategory represents a template category with its count.
type TemplateCategory struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Count int    `json:"count"`
}

// TemplateStore provides Wails-bound methods for template management.
type TemplateStore struct{}

// NewTemplateStore creates a new TemplateStore instance.
func NewTemplateStore() *TemplateStore {
	return &TemplateStore{}
}

func generateTemplateID() string {
	return fmt.Sprintf("tpl-%d", time.Now().UnixNano())
}

// GetTemplates returns all templates from the bbolt "templates" bucket.
func (ts *TemplateStore) GetTemplates() ([]Template, error) {
	templates := ts.GetBuiltinTemplates()

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var t Template
			if err := json.Unmarshal(v, &t); err != nil {
				log.Printf("[templates] failed to unmarshal template %s: %v", string(k), err)
				continue
			}
			templates = append(templates, t)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list templates: %w", err)
	}

	return templates, nil
}

// GetTemplatesByCategory returns templates filtered by category.
func (ts *TemplateStore) GetTemplatesByCategory(category string) ([]Template, error) {
	templates := make([]Template, 0)
	for _, t := range ts.GetBuiltinTemplates() {
		if t.Category == category {
			templates = append(templates, t)
		}
	}

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var t Template
			if err := json.Unmarshal(v, &t); err != nil {
				log.Printf("[templates] failed to unmarshal template %s: %v", string(k), err)
				continue
			}
			if t.Category == category {
				templates = append(templates, t)
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list templates by category: %w", err)
	}

	return templates, nil
}

// SearchTemplates searches templates by name, description, and tags.
func (ts *TemplateStore) SearchTemplates(query string) ([]Template, error) {
	templates := make([]Template, 0)
	q := strings.ToLower(query)
	for _, t := range ts.GetBuiltinTemplates() {
		if ts.matchesQuery(t, q) {
			templates = append(templates, t)
		}
	}

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b == nil {
			return nil
		}
		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var t Template
			if err := json.Unmarshal(v, &t); err != nil {
				continue
			}
			if ts.matchesQuery(t, q) {
				templates = append(templates, t)
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to search templates: %w", err)
	}

	return templates, nil
}

func (ts *TemplateStore) matchesQuery(t Template, query string) bool {
	if strings.Contains(strings.ToLower(t.Name), query) {
		return true
	}
	if strings.Contains(strings.ToLower(t.Description), query) {
		return true
	}
	for _, tag := range t.Tags {
		if strings.Contains(strings.ToLower(tag), query) {
			return true
		}
	}
	return false
}

// GetTemplate retrieves a single template by ID.
func (ts *TemplateStore) GetTemplate(id string) (*Template, error) {
	var tpl Template
	for _, builtin := range ts.GetBuiltinTemplates() {
		if builtin.ID == id {
			copy := builtin
			now := time.Now().UTC().Format(time.RFC3339)
			if copy.CreatedAt == "" {
				copy.CreatedAt = now
			}
			if copy.UpdatedAt == "" {
				copy.UpdatedAt = copy.CreatedAt
			}
			return &copy, nil
		}
	}

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b == nil {
			return fmt.Errorf("templates bucket not found")
		}
		v := b.Get([]byte(id))
		if v == nil {
			return fmt.Errorf("template not found: %s", id)
		}
		return json.Unmarshal(v, &tpl)
	})
	if err != nil {
		return nil, err
	}

	return &tpl, nil
}

// SaveTemplate upserts a template into the store. Generates an ID if empty.
func (ts *TemplateStore) SaveTemplate(t Template) error {
	now := time.Now().UTC().Format(time.RFC3339)

	if t.ID == "" {
		t.ID = generateTemplateID()
		t.CreatedAt = now
	}
	if t.Version == "" {
		t.Version = "1.0.0"
	}
	if t.Author == "" {
		t.Author = "Local"
	}
	if t.Category == "" {
		t.Category = "collection"
	}
	if t.CreatedAt == "" {
		t.CreatedAt = now
	}
	t.UpdatedAt = now

	if t.Tags == nil {
		t.Tags = []string{}
	}

	data, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("failed to marshal template: %w", err)
	}

	err = storeDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte("templates"))
		if err != nil {
			return err
		}
		return b.Put([]byte(t.ID), data)
	})
	if err != nil {
		return fmt.Errorf("failed to save template: %w", err)
	}

	log.Printf("[templates] saved template: %s (%s)", t.Name, t.ID)
	return nil
}

// DeleteTemplate removes a template from the store by ID.
func (ts *TemplateStore) DeleteTemplate(id string) error {
	err := storeDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b == nil {
			return nil
		}
		return b.Delete([]byte(id))
	})
	if err != nil {
		return fmt.Errorf("failed to delete template: %w", err)
	}

	log.Printf("[templates] deleted template: %s", id)
	return nil
}

// ExportTemplate returns the JSON string representation of a template.
func (ts *TemplateStore) ExportTemplate(id string) (string, error) {
	tpl, err := ts.GetTemplate(id)
	if err != nil {
		return "", err
	}

	data, err := json.MarshalIndent(tpl, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to export template: %w", err)
	}

	return string(data), nil
}

// ImportTemplate parses a JSON string and saves the template to the store.
func (ts *TemplateStore) ImportTemplate(jsonStr string) (*Template, error) {
	var tpl Template
	if err := json.Unmarshal([]byte(jsonStr), &tpl); err != nil {
		return nil, fmt.Errorf("failed to parse template JSON: %w", err)
	}
	if strings.TrimSpace(tpl.Name) == "" {
		return nil, fmt.Errorf("template name is required")
	}
	if strings.TrimSpace(tpl.Content) == "" {
		return nil, fmt.Errorf("template content is required")
	}

	// Assign a new ID to avoid collisions
	tpl.ID = generateTemplateID()
	tpl.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	tpl.UpdatedAt = tpl.CreatedAt

	if err := ts.SaveTemplate(tpl); err != nil {
		return nil, err
	}

	log.Printf("[templates] imported template: %s (%s)", tpl.Name, tpl.ID)
	return &tpl, nil
}

// ImportTemplateFile reads a template JSON file from disk and imports it.
func (ts *TemplateStore) ImportTemplateFile(filePath string) (*Template, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read template file: %w", err)
	}

	return ts.ImportTemplate(string(data))
}

// GetCategories returns all template categories with their counts.
func (ts *TemplateStore) GetCategories() ([]TemplateCategory, error) {
	counts := map[string]int{}

	err := storeDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte("templates"))
		if b != nil {
			c := b.Cursor()
			for k, v := c.First(); k != nil; k, v = c.Next() {
				var t Template
				if err := json.Unmarshal(v, &t); err != nil {
					continue
				}
				counts[t.Category]++
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get categories: %w", err)
	}

	categoryMeta := map[string]TemplateCategory{
		"request":     {ID: "request", Name: "Requests", Icon: "send"},
		"collection":  {ID: "collection", Name: "Collections", Icon: "folder"},
		"flow":        {ID: "flow", Name: "Flows", Icon: "git-branch"},
		"mock":        {ID: "mock", Name: "Mock Servers", Icon: "server"},
		"environment": {ID: "environment", Name: "Environments", Icon: "settings"},
	}
	for _, t := range ts.GetBuiltinTemplates() {
		counts[t.Category]++
	}

	categories := make([]TemplateCategory, 0)
	for id, meta := range categoryMeta {
		meta.Count = counts[id]
		categories = append(categories, meta)
	}

	return categories, nil
}

// InstallTemplate "installs" a template by returning its content for the frontend.
func (ts *TemplateStore) InstallTemplate(id string) (string, error) {
	tpl, err := ts.GetTemplate(id)
	if err != nil {
		return "", err
	}

	// Increment download count
	tpl.Downloads++
	if saveErr := ts.SaveTemplate(*tpl); saveErr != nil {
		log.Printf("[templates] failed to increment downloads for %s: %v", id, saveErr)
	}

	log.Printf("[templates] installed template: %s (%s)", tpl.Name, tpl.ID)
	return tpl.Content, nil
}

// GetBuiltinTemplates returns hardcoded starter templates.
func (ts *TemplateStore) GetBuiltinTemplates() []Template {
	return []Template{
		{
			ID:          "builtin-rest-crud",
			Name:        "REST API CRUD",
			Description: "Standard GET/POST/PUT/DELETE requests for a RESTful resource with auth headers",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "collection",
			Tags:        []string{"rest", "crud", "api", "starter"},
			Icon:        "layers",
			Downloads:   0,
			Content:     `{"requests":[{"name":"List Resources","method":"GET","url":"{{baseUrl}}/resources","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true},{"key":"Accept","value":"application/json","enabled":true}]},{"name":"Get Resource","method":"GET","url":"{{baseUrl}}/resources/{{id}}","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true}]},{"name":"Create Resource","method":"POST","url":"{{baseUrl}}/resources","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}],"body":{"type":"json","raw":"{\"name\":\"New Resource\",\"description\":\"A new resource\",\"active\":true}"}},{"name":"Update Resource","method":"PUT","url":"{{baseUrl}}/resources/{{id}}","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}],"body":{"type":"json","raw":"{\"name\":\"Updated Resource\",\"description\":\"Updated description\",\"active\":false}"}},{"name":"Delete Resource","method":"DELETE","url":"{{baseUrl}}/resources/{{id}}","headers":[{"key":"Authorization","value":"Bearer {{token}}","enabled":true}]}]}`,
		},
		{
			ID:          "builtin-oauth2-pkce",
			Name:        "Auth Flow - OAuth2 PKCE",
			Description: "Complete OAuth2 PKCE flow: authorize, token exchange, refresh, and revoke",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "collection",
			Tags:        []string{"oauth2", "pkce", "auth", "security"},
			Icon:        "shield",
			Downloads:   0,
			Content:     `{"requests":[{"name":"Authorize (PKCE)","method":"GET","url":"{{authServer}}/authorize?response_type=code&client_id={{clientId}}&redirect_uri={{redirectUri}}&scope={{scopes}}&state={{state}}&code_challenge={{codeChallenge}}&code_challenge_method=S256","headers":[]},{"name":"Token Exchange","method":"POST","url":"{{authServer}}/token","headers":[{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"grant_type","value":"authorization_code"},{"key":"code","value":"{{authCode}}"},{"key":"redirect_uri","value":"{{redirectUri}}"},{"key":"client_id","value":"{{clientId}}"},{"key":"code_verifier","value":"{{codeVerifier}}"}]}},{"name":"Refresh Token","method":"POST","url":"{{authServer}}/token","headers":[{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"grant_type","value":"refresh_token"},{"key":"refresh_token","value":"{{refreshToken}}"},{"key":"client_id","value":"{{clientId}}"}]}},{"name":"Revoke Token","method":"POST","url":"{{authServer}}/revoke","headers":[{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true},{"key":"Authorization","value":"Basic {{clientCredentials}}","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"token","value":"{{accessToken}}"},{"key":"token_type_hint","value":"access_token"}]}}]}`,
		},
		{
			ID:          "builtin-stripe-api",
			Name:        "Stripe API",
			Description: "Common Stripe API operations: charges, customers, and subscriptions",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "collection",
			Tags:        []string{"stripe", "payments", "api", "fintech"},
			Icon:        "credit-card",
			Downloads:   0,
			Content:     `{"requests":[{"name":"List Customers","method":"GET","url":"https://api.stripe.com/v1/customers?limit=10","headers":[{"key":"Authorization","value":"Bearer {{stripeSecretKey}}","enabled":true}]},{"name":"Create Customer","method":"POST","url":"https://api.stripe.com/v1/customers","headers":[{"key":"Authorization","value":"Bearer {{stripeSecretKey}}","enabled":true},{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"email","value":"customer@your-domain.com"},{"key":"name","value":"John Doe"},{"key":"description","value":"New customer"}]}},{"name":"Create Charge","method":"POST","url":"https://api.stripe.com/v1/charges","headers":[{"key":"Authorization","value":"Bearer {{stripeSecretKey}}","enabled":true},{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"amount","value":"2000"},{"key":"currency","value":"usd"},{"key":"source","value":"tok_visa"},{"key":"description","value":"Test charge"}]}},{"name":"List Subscriptions","method":"GET","url":"https://api.stripe.com/v1/subscriptions?limit=10","headers":[{"key":"Authorization","value":"Bearer {{stripeSecretKey}}","enabled":true}]},{"name":"Create Subscription","method":"POST","url":"https://api.stripe.com/v1/subscriptions","headers":[{"key":"Authorization","value":"Bearer {{stripeSecretKey}}","enabled":true},{"key":"Content-Type","value":"application/x-www-form-urlencoded","enabled":true}],"body":{"type":"urlencoded","params":[{"key":"customer","value":"{{customerId}}"},{"key":"items[0][price]","value":"{{priceId}}"}]}}]}`,
		},
		{
			ID:          "builtin-health-check-flow",
			Name:        "Health Check Flow",
			Description: "Sequential health checks across multiple services with retry logic",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "flow",
			Tags:        []string{"health", "monitoring", "flow", "devops"},
			Icon:        "activity",
			Downloads:   0,
			Content:     `{"name":"Health Check Flow","nodes":[{"id":"node-1","type":"request","label":"Check API Gateway","request":{"method":"GET","url":"{{baseUrl}}/health","headers":[]},"position":{"x":100,"y":100}},{"id":"node-2","type":"condition","label":"API OK?","condition":"response.status === 200","position":{"x":100,"y":250}},{"id":"node-3","type":"request","label":"Check Auth Service","request":{"method":"GET","url":"{{authService}}/health","headers":[]},"position":{"x":100,"y":400}},{"id":"node-4","type":"request","label":"Check Database","request":{"method":"GET","url":"{{baseUrl}}/health/db","headers":[{"key":"Authorization","value":"Bearer {{adminToken}}","enabled":true}]},"position":{"x":100,"y":550}},{"id":"node-5","type":"request","label":"Retry API Gateway","request":{"method":"GET","url":"{{baseUrl}}/health","headers":[]},"position":{"x":350,"y":250}}],"edges":[{"from":"node-1","to":"node-2"},{"from":"node-2","to":"node-3","label":"true"},{"from":"node-2","to":"node-5","label":"false"},{"from":"node-3","to":"node-4"},{"from":"node-5","to":"node-2"}]}`,
		},
		{
			ID:          "builtin-load-test-basic",
			Name:        "Load Test - Basic",
			Description: "Echo endpoint mock with configurable delay for load testing scenarios",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "mock",
			Tags:        []string{"load-test", "mock", "performance", "echo"},
			Icon:        "zap",
			Downloads:   0,
			Content:     `{"mockConfig":{"name":"Load Test Echo Server","port":9090,"endpoints":[{"path":"/echo","method":"POST","responses":[{"status":200,"headers":{"Content-Type":"application/json","X-Response-Time":"{{responseTime}}"},"body":"{\"echo\":true,\"timestamp\":\"{{timestamp}}\",\"message\":\"Request received\"}","delay":0,"active":true}]},{"path":"/echo/slow","method":"POST","responses":[{"status":200,"headers":{"Content-Type":"application/json"},"body":"{\"echo\":true,\"slow\":true,\"delay\":\"500ms\"}","delay":500,"active":true}]},{"path":"/health","method":"GET","responses":[{"status":200,"headers":{"Content-Type":"application/json"},"body":"{\"status\":\"healthy\",\"uptime\":\"{{uptime}}\"}","delay":0,"active":true}]},{"path":"/error","method":"GET","responses":[{"status":500,"headers":{"Content-Type":"application/json"},"body":"{\"error\":\"Internal Server Error\",\"code\":\"MOCK_ERROR\"}","delay":100,"active":true}]}]}}`,
		},
		{
			ID:          "builtin-github-api",
			Name:        "GitHub API",
			Description: "Common GitHub REST API operations: repos, issues, and pull requests",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "collection",
			Tags:        []string{"github", "api", "git", "devtools"},
			Icon:        "github",
			Downloads:   0,
			Content:     `{"requests":[{"name":"List Repos","method":"GET","url":"https://api.github.com/user/repos?sort=updated&per_page=20","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true},{"key":"X-GitHub-Api-Version","value":"2022-11-28","enabled":true}]},{"name":"Get Repository","method":"GET","url":"https://api.github.com/repos/{{owner}}/{{repo}}","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true}]},{"name":"List Issues","method":"GET","url":"https://api.github.com/repos/{{owner}}/{{repo}}/issues?state=open&per_page=20","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true}]},{"name":"Create Issue","method":"POST","url":"https://api.github.com/repos/{{owner}}/{{repo}}/issues","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}],"body":{"type":"json","raw":"{\"title\":\"Bug: Something is broken\",\"body\":\"Description of the issue\",\"labels\":[\"bug\"]}"}},{"name":"List Pull Requests","method":"GET","url":"https://api.github.com/repos/{{owner}}/{{repo}}/pulls?state=open","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true}]},{"name":"Create Pull Request","method":"POST","url":"https://api.github.com/repos/{{owner}}/{{repo}}/pulls","headers":[{"key":"Authorization","value":"Bearer {{githubToken}}","enabled":true},{"key":"Accept","value":"application/vnd.github+json","enabled":true},{"key":"Content-Type","value":"application/json","enabled":true}],"body":{"type":"json","raw":"{\"title\":\"Feature: Add new endpoint\",\"body\":\"This PR adds...\",\"head\":\"feature-branch\",\"base\":\"main\"}"}}]}`,
		},
		{
			ID:          "builtin-jwt-env",
			Name:        "JWT Auth",
			Description: "Environment with JWT authentication variables and token management",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "environment",
			Tags:        []string{"jwt", "auth", "environment", "tokens"},
			Icon:        "key",
			Downloads:   0,
			Content:     `{"environment":{"name":"JWT Auth Environment","variables":[{"key":"baseUrl","value":"https://api.your-domain.com/v1","enabled":true},{"key":"authUrl","value":"https://auth.your-domain.com","enabled":true},{"key":"clientId","value":"your-client-id","enabled":true},{"key":"clientSecret","value":"","enabled":true},{"key":"username","value":"user@your-domain.com","enabled":true},{"key":"password","value":"","enabled":true},{"key":"accessToken","value":"","enabled":true},{"key":"refreshToken","value":"","enabled":true},{"key":"tokenExpiry","value":"","enabled":true},{"key":"jwtIssuer","value":"https://auth.your-domain.com","enabled":true},{"key":"jwtAudience","value":"https://api.your-domain.com","enabled":true}]}}`,
		},
		{
			ID:          "builtin-soap-service",
			Name:        "SOAP Service",
			Description: "Sample SOAP requests with XML envelope for common web service operations",
			Author:      "adOmnia",
			Version:     "1.0.0",
			Category:    "collection",
			Tags:        []string{"soap", "xml", "wsdl", "enterprise"},
			Icon:        "file-code",
			Downloads:   0,
			Content:     `{"requests":[{"name":"GetUser (SOAP)","method":"POST","url":"{{soapEndpoint}}","headers":[{"key":"Content-Type","value":"text/xml; charset=utf-8","enabled":true},{"key":"SOAPAction","value":"http://your-api.com/GetUser","enabled":true}],"body":{"type":"xml","raw":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://your-api.com/userservice\">\n  <soap:Header>\n    <ns:AuthToken>{{soapToken}}</ns:AuthToken>\n  </soap:Header>\n  <soap:Body>\n    <ns:GetUserRequest>\n      <ns:UserId>{{userId}}</ns:UserId>\n    </ns:GetUserRequest>\n  </soap:Body>\n</soap:Envelope>"}},{"name":"CreateUser (SOAP)","method":"POST","url":"{{soapEndpoint}}","headers":[{"key":"Content-Type","value":"text/xml; charset=utf-8","enabled":true},{"key":"SOAPAction","value":"http://your-api.com/CreateUser","enabled":true}],"body":{"type":"xml","raw":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://your-api.com/userservice\">\n  <soap:Header>\n    <ns:AuthToken>{{soapToken}}</ns:AuthToken>\n  </soap:Header>\n  <soap:Body>\n    <ns:CreateUserRequest>\n      <ns:Username>johndoe</ns:Username>\n      <ns:Email>john@your-domain.com</ns:Email>\n      <ns:Role>user</ns:Role>\n    </ns:CreateUserRequest>\n  </soap:Body>\n</soap:Envelope>"}},{"name":"ListUsers (SOAP)","method":"POST","url":"{{soapEndpoint}}","headers":[{"key":"Content-Type","value":"text/xml; charset=utf-8","enabled":true},{"key":"SOAPAction","value":"http://your-api.com/ListUsers","enabled":true}],"body":{"type":"xml","raw":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://your-api.com/userservice\">\n  <soap:Header>\n    <ns:AuthToken>{{soapToken}}</ns:AuthToken>\n  </soap:Header>\n  <soap:Body>\n    <ns:ListUsersRequest>\n      <ns:Page>1</ns:Page>\n      <ns:PageSize>50</ns:PageSize>\n    </ns:ListUsersRequest>\n  </soap:Body>\n</soap:Envelope>"}},{"name":"DeleteUser (SOAP)","method":"POST","url":"{{soapEndpoint}}","headers":[{"key":"Content-Type","value":"text/xml; charset=utf-8","enabled":true},{"key":"SOAPAction","value":"http://your-api.com/DeleteUser","enabled":true}],"body":{"type":"xml","raw":"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ns=\"http://your-api.com/userservice\">\n  <soap:Header>\n    <ns:AuthToken>{{soapToken}}</ns:AuthToken>\n  </soap:Header>\n  <soap:Body>\n    <ns:DeleteUserRequest>\n      <ns:UserId>{{userId}}</ns:UserId>\n      <ns:Confirm>true</ns:Confirm>\n    </ns:DeleteUserRequest>\n  </soap:Body>\n</soap:Envelope>"}}]}`,
		},
	}
}
