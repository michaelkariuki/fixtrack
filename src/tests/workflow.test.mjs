import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, Log, LogLevel } from 'miniflare'
const root = fileURLToPath(new URL('../../', import.meta.url))

async function fixture(t, bindings = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'fixtrack-regression-'))
  await build({ entryPoints: [join(root,'src/index.ts')], outfile: join(directory,'worker.mjs'), bundle:true, format:'esm', platform:'browser', target:'es2022' })
  const mf = new Miniflare({ modules:true, script:await readFile(join(directory,'worker.mjs'),'utf8'), compatibilityDate:'2026-06-11', d1Databases:{DB:'test'}, r2Buckets:{ATTACHMENTS:'test'}, bindings:{AUTH_DEV_LINKS:'true',...bindings}, log:new Log(LogLevel.NONE) })
  t.after(async()=>{ await mf.dispose(); await rm(directory,{recursive:true,force:true}) })
  const db = await mf.getD1Database('DB')
  const migrationFiles = (await readdir(join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort()
  for (const file of migrationFiles) {
    const sql = await readFile(join(root, 'migrations', file), 'utf8')
    await db.batch(sql.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)))
  }
  let cookie=''
  async function request(path,body,method=body?'POST':'GET',headers={}) {
    const merged={...(body?{'Content-Type':'application/json'}:{}),...headers}
    if(cookie && !merged.Cookie) merged.Cookie=cookie
    const response=await mf.dispatchFetch(`https://fixtrack.test/api${path}`,{method,headers:merged,body:body?JSON.stringify(body):undefined})
    const setCookie=response.headers.get('set-cookie')
    if(setCookie) cookie=setCookie.split(';')[0]
    const text=await response.text()
    return {status:response.status,data:text?JSON.parse(text):null}
  }
  async function upload(path,body,headers={}) {
    const merged={...headers}; if(cookie && !merged.Cookie) merged.Cookie=cookie
    const response=await mf.dispatchFetch(`https://fixtrack.test/api${path}`,{method:'POST',headers:merged,body})
    return {status:response.status,data:await response.json()}
  }
  async function download(path) {
    return mf.dispatchFetch(`https://fixtrack.test/api${path}`,{headers:cookie?{Cookie:cookie}:{}})
  }
  async function newSession(email=`other-${crypto.randomUUID()}@example.com`) {
    const saved=cookie; cookie=''
    const result=await request('/auth/signup',{name:'Other owner',email,password:'correct horse battery'})
    if(result.status!==201) throw new Error('second account signup failed')
    const verified=await request('/auth/verify-email',{token:result.data.dev_link.split('/').pop()})
    if(verified.status!==200) throw new Error('second account verification failed')
    const other=cookie; cookie=saved
    return other
  }
  async function unverifiedSession(email) {
    const saved=cookie; cookie=''
    const result=await request('/auth/signup',{name:'Unverified owner',email,password:'correct horse battery'})
    const other=cookie; cookie=saved
    return {cookie:other,result}
  }
  const ownerSignup=await request('/auth/signup',{name:'Sample owner',email:'owner@example.com',password:'correct horse battery'})
  await request('/auth/verify-email',{token:ownerSignup.data.dev_link.split('/').pop()})
  const a=(await request('/workspaces',{name:'Sample shop A',phone:'0700000001'})).data.workspace.id
  const b=(await request('/workspaces',{name:'Sample shop B',phone:'0700000002'})).data.workspace.id
  const job=(await request('/jobs',{workspace_id:a,customer_name:'Sample customer',customer_phone:'0700000003',device_category:'Laptop',device_model:'Sample laptop',fault_description:'No power'})).data.job.id
  return {request,a,b,job,db,upload,download,newSession,unverifiedSession}
}
function quotation(workspace_id,job_id) { return {workspace_id,job_id,required_deposit:2000,terms:'Diagnostic and repair scope agreed before work.',items:[{description:'Part',quantity:2,unit_price:2000},{description:'Labour',quantity:1,unit_price:1000}]} }

test('quote revisions invalidate old decisions and accepted scope is frozen',async t=>{
  const {request,a,b,job}=await fixture(t)
  assert.equal((await request('/quotes',quotation(b,job))).status,404)
  const first=await request('/quotes',quotation(a,job)); assert.equal(first.status,201)
  const token=first.data.quote.approval_token
  assert.equal((await request(`/quotes/public/${token}/changes`,{customer_notes:'Please specify the replacement part.'})).status,200)
  const second=await request('/quotes',quotation(a,job)); assert.equal(second.status,201)
  assert.equal((await request(`/quotes/public/${token}/approve`,{})).status,409)
  const nextToken=second.data.quote.approval_token
  assert.equal((await request(`/quotes/public/${nextToken}/approve`,{})).status,200)
  const accepted=(await request(`/quotes/public/${nextToken}`)).data
  assert.equal(accepted.quote.total_amount,5000)
  assert.equal(accepted.items[0].quantity*accepted.items[0].unit_price,4000)
  assert.equal((await request(`/quotes/public/${nextToken}/approve`,{})).status,200)
  assert.equal((await request(`/quotes/public/${nextToken}`)).data.quote.approved_at,accepted.quote.approved_at)
  assert.equal((await request('/quotes',quotation(a,job))).status,409)
  const history=(await request(`/quotes/job/${job}?workspace_id=${a}`)).data
  assert.deepEqual(history.quotes.map(quote=>quote.status),['approved','superseded'])
  assert.deepEqual((await request(`/quotes/job/${job}?workspace_id=${b}`)).data.quotes,[])
})

test('settlement is exact, replay-safe and separate from collection',async t=>{
  const {request,a,b,job}=await fixture(t)
  const before={workspace_id:a,job_id:job,request_id:crypto.randomUUID(),amount:1000,payment_method:'cash'}
  assert.equal((await request('/payments',before)).status,409)
  const created=(await request('/quotes',quotation(a,job))).data.quote
  assert.equal((await request(`/quotes/public/${created.approval_token}`)).data.payments,undefined)
  await request(`/quotes/public/${created.approval_token}/approve`,{})
  assert.equal((await request(`/jobs/${job}/status`,{workspace_id:a,status:'delivered'},'PATCH')).status,409)
  const deposit={...before,request_id:crypto.randomUUID(),amount:2000}
  const paid=await request('/payments',deposit); assert.equal(paid.data.payment.remaining_balance,3000)
  const publicAfterDeposit=(await request(`/quotes/public/${created.approval_token}`)).data
  assert.deepEqual(publicAfterDeposit.payments,{total_paid:2000,remaining_balance:3000,mpesa_enabled:false})
  assert.equal((await request('/payments',deposit)).data.payment.total_paid,2000)
  assert.equal((await request('/payments',{...deposit,amount:3000})).status,409)
  assert.equal((await request('/payments',{...deposit,request_id:crypto.randomUUID(),workspace_id:b})).status,409)
  const final=await request('/payments',{...deposit,request_id:crypto.randomUUID(),amount:3000})
  assert.equal(final.data.payment.remaining_balance,0)
  const publicSettled=(await request(`/quotes/public/${created.approval_token}`)).data
  assert.deepEqual(publicSettled.payments,{total_paid:5000,remaining_balance:0,mpesa_enabled:false})
  assert.equal((await request(`/jobs?workspace_id=${a}`)).data.jobs[0].status,'approved')
  for(const status of ['in_repair','ready','delivered']) assert.equal((await request(`/jobs/${job}/status`,{workspace_id:a,status},'PATCH')).status,200)
  assert.equal((await request(`/jobs?workspace_id=${a}`)).data.jobs[0].status,'delivered')
  assert.deepEqual((await request(`/jobs?workspace_id=${b}`)).data.jobs,[])
  assert.equal((await request('/payments',{...deposit,request_id:crypto.randomUUID(),amount:1})).status,409)
})

test('concurrent balance writes cannot overpay and bad amounts do not persist',async t=>{
  const {request,a,job}=await fixture(t)
  const quote=(await request('/quotes',quotation(a,job))).data.quote
  await request(`/quotes/public/${quote.approval_token}/approve`,{})
  const payment={workspace_id:a,job_id:job,amount:3000,payment_method:'cash'}
  const results=await Promise.all([request('/payments',{...payment,request_id:crypto.randomUUID()}),request('/payments',{...payment,request_id:crypto.randomUUID()})])
  assert.deepEqual(results.map(result=>result.status).sort(),[201,409])
  for(const amount of [-1,0,1.5,'200']) assert.equal((await request('/payments',{...payment,request_id:crypto.randomUUID(),amount})).status,400)
  assert.equal((await request('/payments',{...payment,request_id:crypto.randomUUID(),amount:1000,payment_method:'mpesa'})).status,400)
  const balance=(await request(`/payments/job/${job}?workspace_id=${a}`)).data
  assert.equal(balance.total_paid,3000); assert.equal(balance.remaining_balance,2000)
  assert.equal(balance.payments.length,1)
})

async function approvedQuote(request, workspaceId, jobId) {
  const quote=(await request('/quotes',quotation(workspaceId,jobId))).data.quote
  await request(`/quotes/public/${quote.approval_token}/approve`,{})
  return quote
}
async function seedIntent(db,{workspaceId,jobId,quote,amount=5000,checkoutRequestId}) {
  const id=crypto.randomUUID()
  await db.prepare('INSERT INTO payment_intents (id,workspace_id,job_id,quote_id,amount,phone,checkout_request_id) VALUES (?,?,?,?,?,?,?)')
    .bind(id,workspaceId,jobId,quote.id,amount,'254712345678',checkoutRequestId).run()
  return id
}
function callbackBody(checkoutRequestId,{code=0,desc='The service request is processed successfully.',amount=5000,receipt='QK123ABC'}={}) {
  return { Body: { stkCallback: { MerchantRequestID:'m-request', CheckoutRequestID:checkoutRequestId, ResultCode:code, ResultDesc:desc, ...(code===0?{CallbackMetadata:{Item:[{Name:'Amount',Value:amount},{Name:'MpesaReceiptNumber',Value:receipt},{Name:'PhoneNumber',Value:254712345678}]}}:{}) } } }
}

test('M-Pesa callback applies a payment exactly once and exposes its status',async t=>{
  const {request,a,job,db}=await fixture(t)
  const quote=await approvedQuote(request,a,job)
  const intentId=await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_TEST_1'})
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_TEST_1'))).status,200)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM payment_records').first()).count,1)
  const status=(await request(`/mpesa/intent/${intentId}?token=${quote.approval_token}`)).data.intent
  assert.equal(status.status,'paid'); assert.equal(status.provider_receipt,'QK123ABC'); assert.equal(status.amount,5000)
  assert.equal((await request(`/mpesa/intent/${intentId}?token=wrong`)).status,404)
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_TEST_1'))).status,200)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM payment_records').first()).count,1)
  const balance=(await request(`/payments/job/${job}?workspace_id=${a}`)).data
  assert.equal(balance.total_paid,5000); assert.equal(balance.remaining_balance,0)
  assert.equal((await request(`/quotes/public/${quote.approval_token}`)).data.payments.remaining_balance,0)
})

test('M-Pesa failures and mismatches never create payments',async t=>{
  const {request,a,job,db}=await fixture(t)
  const quote=await approvedQuote(request,a,job)
  const cancelled=await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_CANCELLED'})
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_CANCELLED',{code:1032,desc:'Request cancelled by user'}))).status,200)
  assert.equal((await request(`/mpesa/intent/${cancelled}?token=${quote.approval_token}`)).data.intent.status,'cancelled')
  const mismatched=await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_MISMATCH'})
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_MISMATCH',{amount:4000}))).status,200)
  const unmatched=(await request(`/mpesa/intent/${mismatched}?token=${quote.approval_token}`)).data.intent
  assert.equal(unmatched.status,'unmatched'); assert.equal(unmatched.provider_receipt,'QK123ABC')
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_UNKNOWN'))).status,200)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM payment_records').first()).count,0)
  assert.equal((await request(`/mpesa/intent/${mismatched}?token=${quote.approval_token}`)).data.intent.message,'Payment received. The shop will confirm it.')
})

test('public quote advertises M-Pesa only when configured',async t=>{
  const configured=await fixture(t,{MPESA_CONSUMER_KEY:'test-key',MPESA_CONSUMER_SECRET:'test-secret',MPESA_SHORTCODE:'174379',MPESA_PASSKEY:'test-passkey'})
  const quote=await approvedQuote(configured.request,configured.a,configured.job)
  const payments=(await configured.request(`/quotes/public/${quote.approval_token}`)).data.payments
  assert.equal(payments.mpesa_enabled,true)
  assert.equal(payments.remaining_balance,5000)
})

test('M-Pesa rejects invalid phones, unconfigured deployments and unauthenticated callbacks',async t=>{
  const {request,a,job,db}=await fixture(t,{MPESA_CALLBACK_TOKEN:'test-callback-secret'})
  const quote=await approvedQuote(request,a,job)
  assert.equal((await request('/mpesa/stkpush',{quote_token:quote.approval_token,phone:'12345'})).status,400)
  assert.equal((await request('/mpesa/stkpush',{quote_token:quote.approval_token,phone:'0712345678'})).status,503)
  await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_SECRET'})
  assert.equal((await request('/mpesa/callback',callbackBody('ws_CO_SECRET'))).status,404)
  assert.equal((await request('/mpesa/callback?token=test-callback-secret',callbackBody('ws_CO_SECRET'))).status,200)
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM payment_records').first()).count,1)
})

test('attachments upload, list and download through R2',async t=>{
  const {request,a,b,job,upload,download}=await fixture(t)
  const bytes=new TextEncoder().encode('device photos')
  const created=await upload(`/attachments?workspace_id=${a}&job_id=${job}`,bytes,{'X-File-Name':'intake-note.txt','Content-Type':'text/plain'})
  assert.equal(created.status,201)
  assert.equal(created.data.attachment.file_name,'intake-note.txt')
  assert.equal(created.data.attachment.file_type,'text/plain')
  const id=created.data.attachment.id
  const list=(await request(`/attachments?workspace_id=${a}&job_id=${job}`)).data
  assert.equal(list.attachments.length,1)
  const file=await download(`/attachments/download/${id}?workspace_id=${a}`)
  assert.equal(file.status,200)
  assert.equal(file.headers.get('content-type'),'text/plain')
  assert.match(file.headers.get('content-disposition'),/intake-note\.txt/)
  assert.equal(await file.text(),'device photos')
  assert.equal((await download(`/attachments/download/${id}?workspace_id=${b}`)).status,404)
  assert.equal((await upload(`/attachments?workspace_id=${a}&job_id=missing`,bytes,{'X-File-Name':'x.txt','Content-Type':'text/plain'})).status,404)
  assert.equal((await upload(`/attachments?workspace_id=${a}&job_id=${job}`,bytes,{'Content-Type':'text/plain'})).status,400)
})

test('authentication scopes workspaces and records to members',async t=>{
  const {request,a,newSession}=await fixture(t)
  assert.equal((await request('/workspaces')).data.workspaces.length,2)
  const other=await newSession()
  assert.equal((await request('/workspaces',null,'GET',{Cookie:other})).data.workspaces.length,0)
  assert.equal((await request(`/jobs?workspace_id=${a}`,null,'GET',{Cookie:other})).status,403)
  const intruder=(await request('/workspaces',{name:'Intruder shop',phone:'0700000009'},'POST',{Cookie:other})).data.workspace.id
  assert.equal((await request(`/jobs?workspace_id=${intruder}`,null,'GET',{Cookie:other})).status,200)
  assert.equal((await request(`/jobs?workspace_id=${intruder}`)).status,403)
  assert.equal((await request('/jobs',{workspace_id:intruder,customer_name:'X',customer_phone:'0700000008',device_category:'Laptop',device_model:'X',fault_description:'X'})).status,403)
  assert.equal((await request('/workspaces',null,'GET',{Cookie:'fixtrack_session=invalid'})).status,401)
  await request('/auth/logout',{})
  assert.equal((await request('/workspaces')).status,401)
  assert.equal((await request('/auth/signup',{name:'Sample owner',email:'owner@example.com',password:'correct horse battery'})).status,409)
  const login=await request('/auth/login',{email:'owner@example.com',password:'correct horse battery'})
  assert.equal(login.status,200)
  assert.equal(login.data.user.email,'owner@example.com')
  assert.equal((await request('/workspaces')).data.workspaces.length,2)
})

test('unverified accounts cannot create workspaces until the emailed link is used',async t=>{
  const {request,unverifiedSession}=await fixture(t)
  const pending=await unverifiedSession('pending@example.com')
  assert.equal(pending.result.status,201)
  assert.equal(pending.result.data.user.email_verified,false)
  assert.equal((await request('/workspaces',{name:'Pending shop',phone:'0700000007'},'POST',{Cookie:pending.cookie})).status,403)
  const resend=await request('/auth/resend-verification',{},'POST',{Cookie:pending.cookie})
  assert.equal(resend.status,200)
  const token=resend.data.dev_link.split('/').pop()
  assert.equal((await request('/auth/verify-email',{token})).status,200)
  assert.equal((await request('/auth/me',null,'GET',{Cookie:pending.cookie})).data.user.email_verified,true)
  assert.equal((await request('/workspaces',{name:'Pending shop',phone:'0700000007'},'POST',{Cookie:pending.cookie})).status,201)
})

test('password reset is single-use and revokes sessions',async t=>{
  const {request}=await fixture(t)
  assert.equal((await request('/auth/forgot-password',{email:'unknown@example.com'})).data.dev_link,null)
  const forgot=await request('/auth/forgot-password',{email:'owner@example.com'})
  assert.equal(forgot.status,200)
  const token=forgot.data.dev_link.split('/').pop()
  assert.equal((await request('/auth/reset-password',{token,password:'a much longer password'})).status,200)
  assert.equal((await request('/auth/reset-password',{token,password:'another longer password'})).status,400)
  assert.equal((await request('/workspaces')).status,401)
  assert.equal((await request('/auth/login',{email:'owner@example.com',password:'correct horse battery'})).status,401)
  assert.equal((await request('/auth/login',{email:'owner@example.com',password:'a much longer password'})).status,200)
  assert.equal((await request('/workspaces')).data.workspaces.length,2)
})

test('workspace invitations require the matching account and grant membership',async t=>{
  const {request,a,newSession}=await fixture(t)
  const created=await request(`/workspaces/${a}/invites`,{email:'invitee@example.com',role:'member'})
  assert.equal(created.status,201)
  const token=created.data.dev_link.split('/').pop()
  const preview=await request(`/invites/${token}`)
  assert.equal(preview.status,200); assert.equal(preview.data.invite.workspace_name,'Sample shop A')
  const intruder=await newSession('intruder@example.com')
  assert.equal((await request(`/invites/${token}/accept`,{},'POST',{Cookie:intruder})).status,403)
  const invitee=await newSession('invitee@example.com')
  assert.equal((await request(`/invites/${token}/accept`,{},'POST',{Cookie:invitee})).status,200)
  assert.equal((await request(`/jobs?workspace_id=${a}`,null,'GET',{Cookie:invitee})).status,200)
  const members=(await request(`/workspaces/${a}/members`)).data.members
  assert.equal(members.length,2)
  const inviteeMember=members.find(member=>member.email==='invitee@example.com')
  assert.equal((await request(`/workspaces/${a}/members/${inviteeMember.user_id}`,null,'DELETE')).status,200)
  assert.equal((await request(`/jobs?workspace_id=${a}`,null,'GET',{Cookie:invitee})).status,403)
})

test('rate limits and cross-site requests are rejected',async t=>{
  const {request,unverifiedSession}=await fixture(t)
  assert.equal((await request('/workspaces',{name:'Cross-site',phone:'0700000011'},'POST',{Origin:'https://evil.example'})).status,403)
  for(let index=0;index<4;index+=1) assert.equal((await unverifiedSession(`rate-${index}@example.com`)).result.status,201)
  assert.equal((await unverifiedSession('rate-blocked@example.com')).result.status,429)
})

test('unmatched M-Pesa payments can be recorded or dismissed',async t=>{
  const {request,a,job,db}=await fixture(t)
  const quote=await approvedQuote(request,a,job)
  const first=await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_REVIEW_1'})
  await request('/mpesa/callback',callbackBody('ws_CO_REVIEW_1',{amount:4000}))
  const pending=(await request(`/mpesa/unmatched?workspace_id=${a}&job_id=${job}`)).data.intents
  assert.equal(pending.length,1); assert.equal(pending[0].received_amount,4000)
  assert.equal((await request(`/mpesa/intents/${first}/resolve`,{workspace_id:a,action:'record'})).status,200)
  const balance=(await request(`/payments/job/${job}?workspace_id=${a}`)).data
  assert.equal(balance.total_paid,4000); assert.equal(balance.remaining_balance,1000)
  const second=await seedIntent(db,{workspaceId:a,jobId:job,quote,checkoutRequestId:'ws_CO_REVIEW_2'})
  await request('/mpesa/callback',callbackBody('ws_CO_REVIEW_2',{amount:4000,receipt:'QK999'}))
  assert.equal((await request(`/mpesa/intents/${second}/resolve`,{workspace_id:a,action:'dismiss'})).status,200)
  assert.equal((await request(`/mpesa/unmatched?workspace_id=${a}`)).data.intents.length,0)
  assert.equal((await request(`/mpesa/intents/${second}/resolve`,{workspace_id:a,action:'record'})).status,409)
})

test('quote notifications create share links and guard provider configuration',async t=>{
  const {request,a,job}=await fixture(t)
  await request('/quotes',quotation(a,job))
  const whatsapp=await request('/notifications',{workspace_id:a,job_id:job,channel:'whatsapp'})
  assert.equal(whatsapp.status,201)
  assert.match(whatsapp.data.share_url,/^https:\/\/wa\.me\/254/)
  assert.equal(whatsapp.data.notification.status,'link_generated')
  assert.equal((await request(`/notifications?workspace_id=${a}&job_id=${job}`)).data.notifications.length,1)
  assert.equal((await request('/notifications',{workspace_id:a,job_id:job,channel:'email'})).status,409)
  assert.equal((await request('/notifications',{workspace_id:a,job_id:job,channel:'sms'})).status,503)
})
