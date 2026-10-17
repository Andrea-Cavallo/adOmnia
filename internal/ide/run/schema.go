package run

// FieldType è il tipo di controllo che la UI genera per un campo dello schema.
type FieldType string

const (
	FieldText     FieldType = "text"
	FieldPath     FieldType = "path"
	FieldSelect   FieldType = "select"
	FieldList     FieldType = "list"
	FieldKeyValue FieldType = "keyvalue"
	FieldToggle   FieldType = "toggle"
)

// Sezioni di uno schema: la base è sempre visibile, le avanzate stanno collassate.
const (
	SectionBasic    = "basic"
	SectionAdvanced = "advanced"
)

// FieldOption è una voce di un campo select.
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// FieldCondition rende un campo visibile solo quando un altro campo ha uno dei valori indicati.
type FieldCondition struct {
	Field  string   `json:"field"`
	Equals []string `json:"equals"`
}

// Field descrive un campo di LanguageOptions (o un campo comune che l'adapter vuole ridefinire).
type Field struct {
	Key         string          `json:"key"`
	Label       string          `json:"label"`
	Type        FieldType       `json:"type"`
	Section     string          `json:"section"`
	Required    bool            `json:"required,omitempty"`
	Default     any             `json:"default,omitempty"`
	Help        string          `json:"help,omitempty"`
	Options     []FieldOption   `json:"options,omitempty"`
	VisibleWhen *FieldCondition `json:"visibleWhen,omitempty"`
}

// FieldSchema è serializzabile in JSON: la UI genera i campi da qui, senza `if (language)` nel JSX.
type FieldSchema struct {
	Language string  `json:"language"`
	Kind     string  `json:"kind"`
	Fields   []Field `json:"fields"`
}

// SchemaProvider è una capability opzionale dell'adapter: descrive i campi specifici di un kind.
type SchemaProvider interface {
	RunSchema(kind string) FieldSchema
}

// ConfigValidator è una capability opzionale dell'adapter: valida una configurazione del suo linguaggio.
type ConfigValidator interface {
	ValidateRunConfiguration(Configuration) error
}
