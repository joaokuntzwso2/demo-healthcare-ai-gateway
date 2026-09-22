package customresponsephileakageguard
import (
    "context"
    "encoding/json"
    "fmt"
    "net/url"
    "regexp"
    "strings"
    policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)
var _ = url.URL{}
var _ = strings.Builder{}
const policyName = "custom-response-phi-leakage-guard"

type Policy struct{}
func (p *Policy) Mode() policy.ProcessingMode { return policy.ProcessingMode{RequestHeaderMode:policy.HeaderModeSkip,RequestBodyMode:policy.BodyModeSkip,ResponseHeaderMode:policy.HeaderModeSkip,ResponseBodyMode:policy.BodyModeBuffer} }
func GetPolicy(_ policy.PolicyMetadata, _ map[string]interface{}) (policy.Policy,error){ return &Policy{},nil }
func assistantText(c *policy.ResponseContext)(string,error){if c==nil||c.ResponseBody==nil||len(c.ResponseBody.Content)==0{return "",fmt.Errorf("response body missing")};var v map[string]interface{};if err:=json.Unmarshal(c.ResponseBody.Content,&v);err!=nil{return "",err};if _,ok:=v["error"];ok{return "",nil};choices,_:=v["choices"].([]interface{});if len(choices)==0{return "",fmt.Errorf("choices missing")};first,_:=choices[0].(map[string]interface{});msg,_:=first["message"].(map[string]interface{});s,_:=msg["content"].(string);if s==""{return "",fmt.Errorf("assistant content missing")};return s,nil}
func blockResponse(code,reason string,details map[string]interface{})policy.ImmediateResponse{body,_:=json.Marshal(map[string]interface{}{"type":"HELIOS_CLINICAL_AI_GUARDRAIL","message":map[string]interface{}{"action":"GUARDRAIL_INTERVENED","direction":"RESPONSE","interveningGuardrail":policyName,"reasonCode":code,"actionReason":reason,"details":details}});return policy.ImmediateResponse{StatusCode:422,Headers:map[string]string{"Content-Type":"application/json","Cache-Control":"no-store"},Body:body,AnalyticsMetadata:map[string]any{"reasonCode":code,"heliosBlocked":true}}}
func containsAny(s string,patterns ...string)bool{for _,p:=range patterns{if regexp.MustCompile(p).MatchString(s){return true}};return false}

func (p *Policy) OnResponseBody(_ context.Context, resp *policy.ResponseContext, _ map[string]interface{}) policy.ResponseAction {text,err:=assistantText(resp);if err!=nil{if text==""{return nil};return blockResponse("RESPONSE_STRUCTURE_INVALID",err.Error(),nil)};if containsAny(text,`(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`,`\b\d{3}-\d{2}-\d{4}\b`,`(?i)Synthetic Patient (?:Alpha|Beta)|Paciente Sintético Gama`,`(?i)\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b`){return blockResponse("PHI_PII_SECRET_LEAKAGE","Model response contains a direct identifier or secret not permitted in the response channel.",nil)};return policy.DownstreamResponseModifications{}}
