const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCardAssistant,normalizeAnswers,normalizeSuggestion}=require('../card-assistant');

const answers={occasion:'wedding',hosts:'Mara & Jonas',mood:'romantic',colors:'Salbei und Creme',address:'ihr',wish:'herzlich'};

test('ohne Schalter oder Schlüssel ist der KI-Assistent aus',async()=>{
  assert.equal(createCardAssistant({}).enabled,false);
  assert.equal(createCardAssistant({ANTHROPIC_API_KEY:'k'}).enabled,false);
  assert.equal(createCardAssistant({AI_CARD_ASSISTANT:'on'}).enabled,false);
  await assert.rejects(createCardAssistant({}).suggest(answers),error=>error.status===503);
});

test('Antworten werden bereinigt und auf das Nötigste begrenzt',()=>{
  assert.equal(normalizeAnswers({hosts:'  '}),null);
  const a=normalizeAnswers({hosts:'Mara\n& Jonas',occasion:'evil',mood:'x',address:'Sie',wish:'w'.repeat(900),email:'a@b.de',photo:'data:...'});
  assert.deepEqual(Object.keys(a).sort(),['address','colors','hosts','mood','occasion','wish']);
  assert.equal(a.hosts,'Mara & Jonas');assert.equal(a.occasion,'other');assert.equal(a.mood,'elegant');assert.equal(a.address,'ihr');assert.equal(a.wish.length,300);
});

test('KI-Vorschlag wird streng geprüft',()=>{
  const s=normalizeSuggestion({title:'T'.repeat(200),theme:'hack',accent:'red',font:'comic',qrPosition:'top',invite:'Scannt\ndas'},answers);
  assert.equal(s.title.length,80);assert.equal(s.theme,'afterglow');assert.equal(s.accent,'#e99a69');assert.equal(s.font,'classic');assert.equal(s.qrPosition,'center');assert.equal(s.invite,'Scannt das');
  assert.ok(s.kicker&&s.backKicker&&s.backInvite);
});

test('Anfrage an Claude enthält nur die Fragebogen-Antworten',async()=>{
  let sent=null;
  const client={beta:{messages:{create:async params=>{sent=params;return {stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({title:'Mara & Jonas',kicker:'UNSERE HOCHZEIT',invite:'Scannt den Code und teilt eure Fotos.',backKicker:'TEILT EURE MOMENTE',backInvite:'Jedes Foto zählt.',theme:'garden',accent:'#A8BF83',font:'palatino',qrPosition:'lowerCenter',note:'Romantisch in Salbei.'})}]};}}}};
  const assistant=createCardAssistant({AI_CARD_ASSISTANT:'on'},{client});
  assert.equal(assistant.enabled,true);
  const result=await assistant.suggest(answers);
  assert.equal(result.theme,'garden');assert.equal(result.accent,'#a8bf83');assert.equal(result.qrPosition,'lowerCenter');
  assert.equal(sent.model,'claude-opus-5-5');assert.equal(sent.fallbacks,'default');assert.equal(sent.output_config.format.type,'json_schema');
  assert.equal(sent.messages.length,1);
  assert.match(sent.messages[0].content,/Mara & Jonas/);
  assert.doesNotMatch(JSON.stringify(sent.messages),/token=|@|\/event\//i);
});

test('Ablehnung, Fehler und kaputte Antworten führen zu verständlichen Meldungen',async()=>{
  const make=create=>createCardAssistant({AI_CARD_ASSISTANT:'on'},{client:{beta:{messages:{create}}}});
  await assert.rejects(make(async()=>({stop_reason:'refusal',content:[]})).suggest(answers),e=>e.status===422);
  await assert.rejects(make(async()=>({stop_reason:'end_turn',content:[{type:'text',text:'kein json'}]})).suggest(answers),e=>e.status===502);
  await assert.rejects(make(async()=>{const e=new Error('rate');e.status=429;throw e;}).suggest(answers),e=>e.status===503);
});
