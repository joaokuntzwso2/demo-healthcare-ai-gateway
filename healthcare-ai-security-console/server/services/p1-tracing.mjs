import crypto from 'node:crypto';
const VALID=/^[0-9a-f]{32}$/i;
const NONZERO=/[1-9a-f]/i;
export function wso2TraceContext(heliosEvidenceId){
  const source=String(heliosEvidenceId||'').trim();
  if(!source)return null;
  const compact=source.replace(/-/g,'').toLowerCase();
  let traceId=VALID.test(compact)&&NONZERO.test(compact)
    ?compact
    :crypto.createHash('sha256').update(source).digest('hex').slice(0,32);
  if(!NONZERO.test(traceId))traceId='00000000000000000000000000000001';
  let spanId=crypto.randomBytes(8).toString('hex');
  if(!NONZERO.test(spanId))spanId='0000000000000001';
  return {traceId,spanId,traceparent:`00-${traceId}-${spanId}-01`};
}
