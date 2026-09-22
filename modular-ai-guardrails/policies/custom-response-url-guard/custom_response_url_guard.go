package customresponseurlguard
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
const policyName = "custom-response-url-guard"

type Policy struct{}
func (p *Policy) Mode() policy.ProcessingMode { return policy.ProcessingMode{RequestHeaderMode:policy.HeaderModeSkip,RequestBodyMode:policy.BodyModeSkip,ResponseHeaderMode:policy.HeaderModeSkip,ResponseBodyMode:policy.BodyModeBuffer} }
func GetPolicy(_ policy.PolicyMetadata, _ map[string]interface{}) (policy.Policy,error){ return &Policy{},nil }
func assistantText(c *policy.ResponseContext)(string,error){if c==nil||c.ResponseBody==nil||len(c.ResponseBody.Content)==0{return "",fmt.Errorf("response body missing")};var v map[string]interface{};if err:=json.Unmarshal(c.ResponseBody.Content,&v);err!=nil{return "",err};if _,ok:=v["error"];ok{return "",nil};choices,_:=v["choices"].([]interface{});if len(choices)==0{return "",fmt.Errorf("choices missing")};first,_:=choices[0].(map[string]interface{});msg,_:=first["message"].(map[string]interface{});s,_:=msg["content"].(string);if s==""{return "",fmt.Errorf("assistant content missing")};return s,nil}
func blockResponse(code,reason string,details map[string]interface{})policy.ImmediateResponse{body,_:=json.Marshal(map[string]interface{}{"type":"HELIOS_CLINICAL_AI_GUARDRAIL","message":map[string]interface{}{"action":"GUARDRAIL_INTERVENED","direction":"RESPONSE","interveningGuardrail":policyName,"reasonCode":code,"actionReason":reason,"details":details}});return policy.ImmediateResponse{StatusCode:422,Headers:map[string]string{"Content-Type":"application/json","Cache-Control":"no-store"},Body:body,AnalyticsMetadata:map[string]any{"reasonCode":code,"heliosBlocked":true}}}
func containsAny(s string,patterns ...string)bool{for _,p:=range patterns{if regexp.MustCompile(p).MatchString(s){return true}};return false}

func (p *Policy) OnResponseBody(_ context.Context, resp *policy.ResponseContext, _ map[string]interface{}) policy.ResponseAction {text,err:=assistantText(resp);if err!=nil{if text==""{return nil};return blockResponse("RESPONSE_STRUCTURE_INVALID",err.Error(),nil)};re:=regexp.MustCompile(`https?://[^\s)\]}>]+`);allow:=map[string]bool{"www.fda.gov":true,"fda.gov":true,"www.hhs.gov":true,"hhs.gov":true,"www.gov.br":true,"gov.br":true,"www.nist.gov":true,"nist.gov":true,"owasp.org":true,"www.hl7.org":true,"hl7.org":true,"wso2.com":true,"www.wso2.com":true};for _,raw:=range re.FindAllString(text,-1){u,err:=url.Parse(strings.TrimRight(raw,".,;"));if err!=nil||!allow[strings.ToLower(u.Hostname())]{return blockResponse("UNSAFE_URL","Response contains a URL outside the configured trusted demonstration allowlist.",map[string]interface{}{"url":raw})}};return policy.DownstreamResponseModifications{}}
