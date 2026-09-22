package custommodelallowlistguardrail

import (
    "context"
    "crypto/hmac"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "html"
    "net/url"
    "os"
    "regexp"
    "sort"
    "strconv"
    "strings"
    policy "github.com/wso2/api-platform/sdk/core/policy/v1alpha2"
)

const policyName = "custom-model-allowlist-guardrail"

const pendingKey = "wso2.ai.pending-request-block"
const canonicalKey = "helios.canonical-text"

type Policy struct{}
func (p *Policy) Mode() policy.ProcessingMode { return policy.ProcessingMode{RequestHeaderMode:policy.HeaderModeSkip,RequestBodyMode:policy.BodyModeBuffer,ResponseHeaderMode:policy.HeaderModeSkip,ResponseBodyMode:policy.BodyModeSkip} }
func GetPolicy(_ policy.PolicyMetadata, _ map[string]interface{}) (policy.Policy,error){ return &Policy{},nil }
func parseRequest(c *policy.RequestContext)(map[string]interface{},error){ if c==nil||c.Body==nil||len(c.Body.Content)==0{return nil,fmt.Errorf("request body missing")}; var v map[string]interface{}; if err:=json.Unmarshal(c.Body.Content,&v);err!=nil{return nil,err}; return v,nil }
func ensureMetadata(c *policy.RequestContext){ if c.Metadata==nil{c.Metadata=map[string]interface{}{}} }
func setFinding(c *policy.RequestContext, code, reason string, details map[string]interface{}){ ensureMetadata(c); if _,exists:=c.Metadata[pendingKey];exists{return}; c.Metadata[pendingKey]=map[string]interface{}{"policy":policyName,"reasonCode":code,"reason":reason,"details":details} }
func textParam(v map[string]interface{},key,def string)string{if x,ok:=v[key].(string);ok{return x};return def}
func floatParam(v map[string]interface{},key string,def float64)float64{if x,ok:=v[key].(float64);ok{return x};return def}
func boolParam(v map[string]interface{},key string,def bool)bool{if x,ok:=v[key].(bool);ok{return x};return def}
func messagesText(v map[string]interface{})string{ raw,ok:=v["messages"].([]interface{});if !ok{return ""};var b strings.Builder;for _,m:=range raw{if mm,ok:=m.(map[string]interface{});ok{if s,ok:=mm["content"].(string);ok{b.WriteString(s);b.WriteByte('\n')}}};return b.String() }
func canonicalize(s string)string{ out:=html.UnescapeString(strings.TrimSpace(s)); if d,err:=url.QueryUnescape(out);err==nil{out=d}; tokens:=strings.Fields(out); for _,t:=range tokens{tt:=strings.Trim(t,".,;:()[]{}<>\"'");if len(tt)>=24&&len(tt)%4==0{if b,err:=base64.StdEncoding.DecodeString(tt);err==nil{d:=string(b);if regexp.MustCompile(`[A-Za-z]{4}`).MatchString(d){out+="\n"+d}}}};return out }
func contextMap(v map[string]interface{})map[string]interface{}{ c,_:=v["_helios_context"].(map[string]interface{});return c }
func str(m map[string]interface{},k string)string{v,_:=m[k].(string);return v}
func scopes(m map[string]interface{})[]string{raw,_:=m["scopes"].([]interface{});out:=make([]string,0,len(raw));for _,x:=range raw{if s,ok:=x.(string);ok{out=append(out,s)}};sort.Strings(out);return out}
func hasScope(m map[string]interface{},want string)bool{for _,s:=range scopes(m){if s==want{return true}};return false}
func signedContextPayload(m map[string]interface{})string{return strings.Join([]string{str(m,"tenant"),str(m,"actor"),str(m,"role"),str(m,"patientId"),str(m,"patientPseudonym"),str(m,"encounter"),str(m,"purpose"),str(m,"app"),strings.Join(scopes(m),",")},"|")}
func validContextSignature(m map[string]interface{})bool{key:=os.Getenv("HELIOS_CONTEXT_SIGNING_KEY");if key==""{return false};sig:=str(m,"sig");if sig==""{return false};mac:=hmac.New(sha256.New,[]byte(key));mac.Write([]byte(signedContextPayload(m)));expected:=hex.EncodeToString(mac.Sum(nil));return hmac.Equal([]byte(sig),[]byte(expected))}
func candidateIDs(text,prefix string)[]string{re:=regexp.MustCompile(`(?i)\b`+regexp.QuoteMeta(prefix)+`[a-z0-9-]+\b`);return re.FindAllString(text,-1)}
func containsAny(s string, patterns ...string)bool{for _,p:=range patterns{if regexp.MustCompile(p).MatchString(s){return true}};return false}
func countMessages(v map[string]interface{})int{a,_:=v["messages"].([]interface{});return len(a)}
func countTools(v map[string]interface{})int{a,_:=v["tools"].([]interface{});return len(a)}
func toolNames(v map[string]interface{})[]string{a,_:=v["tools"].([]interface{});out:=[]string{};for _,x:=range a{m,_:=x.(map[string]interface{});fn,_:=m["function"].(map[string]interface{});if n,ok:=fn["name"].(string);ok{out=append(out,n)}};return out}
func intField(v map[string]interface{},k string)int{switch x:=v[k].(type){case float64:return int(x);case int:return x;case string:i,_:=strconv.Atoi(x);return i};return 0}

func (p *Policy) OnRequestBody(_ context.Context, req *policy.RequestContext, _ map[string]interface{}) policy.RequestAction {
    v,err:=parseRequest(req);if err!=nil{setFinding(req,"INVALID_REQUEST_STRUCTURE","Request must be valid JSON.",nil);return nil}
    model,_:=v["model"].(string); allowed:=map[string]bool{"gpt-4.1-mini":true,"gpt-4o-mini":true};if model==""||!allowed[model]{setFinding(req,"MODEL_NOT_ALLOWED","Requested model is absent from the Helios allowlist.",map[string]interface{}{"model":model})}
    return nil
}
