package otlp

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

const maxAttributeValue = 2048

var spanKinds = map[tracepb.Span_SpanKind]string{
	tracepb.Span_SPAN_KIND_INTERNAL: "internal", tracepb.Span_SPAN_KIND_SERVER: "server",
	tracepb.Span_SPAN_KIND_CLIENT: "client", tracepb.Span_SPAN_KIND_PRODUCER: "producer",
	tracepb.Span_SPAN_KIND_CONSUMER: "consumer",
}

// Convert flattens an export request into spans.
func Convert(request *coltracepb.ExportTraceServiceRequest) []Span {
	var out []Span
	for _, resource := range request.GetResourceSpans() {
		resourceAttrs := attributes(resource.GetResource().GetAttributes())
		service := resourceAttrs["service.name"]
		if service == "" {
			service = "unknown_service"
		}
		pid, _ := strconv.Atoi(resourceAttrs["process.pid"])
		for _, scope := range resource.GetScopeSpans() {
			for _, span := range scope.GetSpans() {
				attrs := attributes(span.GetAttributes())
				start, end := span.GetStartTimeUnixNano(), span.GetEndTimeUnixNano()
				duration := 0.0
				if end > start {
					duration = float64(end-start) / 1e6
				}
				converted := Span{
					TraceID:       hex.EncodeToString(span.GetTraceId()),
					SpanID:        hex.EncodeToString(span.GetSpanId()),
					ParentSpanID:  hex.EncodeToString(span.GetParentSpanId()),
					Name:          span.GetName(),
					Kind:          spanKinds[span.GetKind()],
					Service:       service,
					StartMs:       float64(start) / 1e6,
					DurationMs:    duration,
					StatusCode:    strings.TrimPrefix(span.GetStatus().GetCode().String(), "STATUS_CODE_"),
					StatusMessage: span.GetStatus().GetMessage(),
					Category:      category(attrs),
					Attributes:    attrs,
					PID:           pid,
				}
				for _, event := range span.GetEvents() {
					converted.Events = append(converted.Events, SpanEvent{Name: event.GetName(), TimeMs: float64(event.GetTimeUnixNano()) / 1e6, Attributes: attributes(event.GetAttributes())})
				}
				if converted.Kind == "" {
					converted.Kind = "unspecified"
				}
				out = append(out, converted)
			}
		}
	}
	return out
}

// category follows the OpenTelemetry semantic conventions (old and stable attribute names).
func category(attrs map[string]string) string {
	switch {
	case attrs["db.system"] != "" || attrs["db.system.name"] != "":
		return "db"
	case attrs["messaging.system"] != "":
		return "messaging"
	case attrs["rpc.system"] != "":
		return "rpc"
	case attrs["http.request.method"] != "" || attrs["http.method"] != "":
		return "http"
	}
	return "internal"
}

func attributes(values []*commonpb.KeyValue) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]string, len(values))
	for _, kv := range values {
		value := anyValue(kv.GetValue())
		if len(value) > maxAttributeValue {
			value = value[:maxAttributeValue] + "…"
		}
		out[kv.GetKey()] = value
	}
	return out
}

func anyValue(value *commonpb.AnyValue) string {
	switch v := value.GetValue().(type) {
	case *commonpb.AnyValue_StringValue:
		return v.StringValue
	case *commonpb.AnyValue_IntValue:
		return strconv.FormatInt(v.IntValue, 10)
	case *commonpb.AnyValue_DoubleValue:
		return strconv.FormatFloat(v.DoubleValue, 'f', -1, 64)
	case *commonpb.AnyValue_BoolValue:
		return strconv.FormatBool(v.BoolValue)
	case *commonpb.AnyValue_BytesValue:
		return base64.StdEncoding.EncodeToString(v.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		parts := make([]string, 0, len(v.ArrayValue.GetValues()))
		for _, item := range v.ArrayValue.GetValues() {
			parts = append(parts, anyValue(item))
		}
		data, _ := json.Marshal(parts)
		return string(data)
	case *commonpb.AnyValue_KvlistValue:
		data, _ := json.Marshal(attributes(v.KvlistValue.GetValues()))
		return string(data)
	}
	return ""
}

// DecodeJSON reads an OTLP/JSON body. OTLP/JSON encodes trace and span ids as hex while
// protojson expects base64 for bytes fields, so ids are rewritten before decoding.
func DecodeJSON(body []byte) (*coltracepb.ExportTraceServiceRequest, error) {
	var generic any
	if err := json.Unmarshal(body, &generic); err != nil {
		return nil, err
	}
	rewriteIDs(generic)
	normalized, err := json.Marshal(generic)
	if err != nil {
		return nil, err
	}
	request := &coltracepb.ExportTraceServiceRequest{}
	return request, protojson.UnmarshalOptions{DiscardUnknown: true}.Unmarshal(normalized, request)
}

func rewriteIDs(node any) {
	switch value := node.(type) {
	case map[string]any:
		for key, item := range value {
			if text, ok := item.(string); ok && (key == "traceId" || key == "spanId" || key == "parentSpanId") {
				if raw, err := hex.DecodeString(text); err == nil {
					value[key] = base64.StdEncoding.EncodeToString(raw)
				}
				continue
			}
			rewriteIDs(item)
		}
	case []any:
		for _, item := range value {
			rewriteIDs(item)
		}
	}
}
