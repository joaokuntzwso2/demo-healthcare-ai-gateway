package v1alpha2

import "strings"

type HeaderMode int
type BodyMode int

const (
	HeaderModeSkip HeaderMode = iota
	HeaderModeBuffer
)
const (
	BodyModeSkip BodyMode = iota
	BodyModeBuffer
)

type ProcessingMode struct {
	RequestHeaderMode  HeaderMode
	RequestBodyMode    BodyMode
	ResponseHeaderMode HeaderMode
	ResponseBodyMode   BodyMode
}
type PolicyMetadata struct{}
type Policy interface{}
type Body struct {
	Present bool
	Content []byte
}
type Headers map[string][]string

func (h Headers) Get(name string) []string {
	for k, v := range h {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return nil
}
func (h Headers) Has(name string) bool { return len(h.Get(name)) > 0 }

type RequestContext struct {
	Body     *Body
	Headers  Headers
	Metadata map[string]interface{}
}
type ResponseContext struct {
	ResponseBody *Body
	Metadata     map[string]interface{}
}
type RequestAction interface{}
type ResponseAction interface{}
type UpstreamRequestModifications struct {
	Body              []byte
	Path              *string
	HeadersToRemove   []string
	AnalyticsMetadata map[string]any
}
type DownstreamResponseModifications struct {
	Body              []byte
	AnalyticsMetadata map[string]any
}
type ImmediateResponse struct {
	StatusCode        int
	Headers           map[string]string
	Body              []byte
	AnalyticsMetadata map[string]any
}
