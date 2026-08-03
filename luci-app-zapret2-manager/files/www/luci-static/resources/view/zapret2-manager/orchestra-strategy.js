'use strict';
'require view';
'require rpc';
'require ui';

const statusRpc = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
const startRpc = rpc.declare({ object: 'zapret2-manager', method: 'start', reject: true });
const stopRpc = rpc.declare({ object: 'zapret2-manager', method: 'stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_preview', reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_apply', params: ['edit'], reject: true });
const rollbackRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_rollback', reject: true });
const runStartRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const runHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function errorText(e) { if (!e) return _('Неизвестная ошибка'); if (typeof e === 'string') return e; if (e.error) return errorText(e.error); return e.message || e.code || JSON.stringify(e); }
function notify(e, kind) { ui.addNotification(null, E('p', {}, kind === 'error' ? errorText(e) : String(e)), kind || 'info'); }
function btn(label, cls, fn, disabled) { var b=E('button',{type:'button','class':'cbi-button '+(cls||'cbi-button-neutral'),disabled:disabled?true:null},label);b.addEventListener('click',function(){if(!b.disabled)fn(b);});return b; }
function badge(text, kind) { return E('span',{'class':'z2os-badge z2os-'+(kind||'neutral')},text); }
function card(title, body, cls) { return E('section',{'class':'z2os-card '+(cls||'')},[E('h3',{},title),body]); }
function running(status) { var r=status&&status.runtime||{},p=r.process||{};return !!(status&&(status.serviceState==='running'||status.status==='running'||p.found===true)); }
function normalizeTarget(value) { var raw=String(value||'').trim().toLowerCase();try{if(/^[a-z]+:\/\//.test(raw))raw=new URL(raw).hostname;}catch(e){}return raw.replace(/^https?:\/\//,'').split('/')[0].split('@').pop().split(':')[0].replace(/\.$/,''); }
function phaseLabel(p) { return ({queued:'Ожидание',running:'Проверка',probing:'Проверка',ranking:'Рейтинг',completed:'Завершено',partial:'Частично',failed:'Ошибка',stopped:'Остановлено','timed-out':'Таймаут',interrupted:'Прервано'})[p]||p||'Не запускалось'; }

return view.extend({
	pendingStrategyId: null,
	selectedTarget: '',
	activeRunId: null,
	pollTimer: null,

	load: function () {
		return Promise.all([
			statusRpc().catch(function(e){return{error:errorText(e)};}),
			previewRpc().catch(function(e){return{ok:false,error:errorText(e)};}),
			runHistoryRpc().catch(function(){return{ok:false,runs:[]};})
		]);
	},

	injectCss: function () {
		if(document.getElementById('z2os-css'))return;
		var link=document.createElement('link');link.id='z2os-css';link.rel='stylesheet';link.href=L.resource('view/zapret2-manager/orchestra-strategy.css');document.head.appendChild(link);
	},

	rerender: function (data) {
		var old=document.querySelector('.z2os-root'),fresh=this.render(data);if(old&&old.parentNode)old.parentNode.replaceChild(fresh,old);
	},

	applyGlobal: function (candidate, b) {
		var self=this;b.disabled=true;
		return edit(applyRpc,{candidateId:candidate.managerId,expectedDigest:candidate.digest,wideAcknowledged:true,includeOverrides:true,idempotencyToken:'luci-global-'+Date.now()})
			.then(function(r){if(!r||r.ok!==true)throw r;notify(_('Стратегия применена и проверена.'),'info');window.setTimeout(function(){window.location.reload();},500);})
			.catch(function(e){b.disabled=false;notify(e,'error');});
	},

	overrideAction: function (payload, b) {
		if(b)b.disabled=true;payload.idempotencyToken=payload.idempotencyToken||('luci-override-'+Date.now());
		return edit(applyRpc,payload).then(function(r){if(!r||r.ok!==true)throw r;window.location.reload();}).catch(function(e){if(b)b.disabled=false;notify(e,'error');});
	},

	startTargetTest: function (all, box, b) {
		var self=this,target=normalizeTarget(this.selectedTarget);if(!target||target.indexOf('.')<0){notify(_('Введите корректный домен или URL.'),'error');return;}
		if(!all&&!this.pendingStrategyId){notify(_('Сначала выберите стратегию.'),'error');return;}
		b.disabled=true;box.replaceChildren(E('p',{'class':'z2os-muted'},_('Запуск проверки…')));
		return edit(runStartRpc,{targetType:'domain',domain:target,protocols:['tcp_https'],candidateMode:all?'zapret2gui-only':'selected',candidateIds:all?[]:[this.pendingStrategyId],repeats:2,perAttemptTimeoutSec:20,totalTimeoutSec:all?600:90,maxCandidates:all?20:1,maxAttempts:all?60:3})
			.then(function(r){if(!r||r.ok!==true||!r.run)throw r;self.activeRunId=r.run.runId;self.pollRun(box,b);})
			.catch(function(e){b.disabled=false;notify(e,'error');});
	},

	pollRun: function (box, b) {
		var self=this;if(!this.activeRunId)return;
		edit(runStatusRpc,{runId:this.activeRunId}).then(function(r){if(!r||r.ok!==true||!r.run)throw r;self.renderRun(box,r.run);var p=String(r.run.phase||'');if(['completed','partial','failed','stopped','timed-out','timeout','interrupted','infrastructure-error'].indexOf(p)<0)self.pollTimer=window.setTimeout(function(){self.pollRun(box,b);},1800);else b.disabled=false;}).catch(function(e){b.disabled=false;notify(e,'error');});
	},

	renderRun: function (box, run) {
		var ranking=run.canonical&&run.canonical.ranking||run.rankedResults||[],winner=run.selectedWinner||run.canonical&&run.canonical.winner||null;
		var rows=ranking.slice(0,7).map(function(r,i){return E('div',{'class':'z2os-rank-row'},[E('b',{},String(r.rank||i+1)),E('span',{},r.name||r.displayName||r.candidateId||'—'),badge(r.score==null?'—':String(r.score),i===0?'good':'neutral'),E('small',{'class':'z2os-muted'},String(r.confirmations!=null?r.confirmations:r.successCount||0)+'/'+String(r.attempts!=null?r.attempts:r.attemptCount||0))]);});
		box.replaceChildren(E('div',{'class':'z2os-run-head'},[badge(phaseLabel(run.phase),run.phase==='completed'?'good':'neutral'),E('span',{},run.target||'')]),E('div',{'class':'z2os-metrics'},[E('div',{},[E('strong',{},String(run.completedCount||0)),E('small',{},'Выполнено')]),E('div',{},[E('strong',{},String(run.totalCount||'—')),E('small',{},'Всего')]),E('div',{},[E('strong',{},winner&&(winner.displayName||winner.name||winner.candidateId)||'—'),E('small',{},'Победитель')])]),E('div',{'class':'z2os-ranking'},rows.length?rows:E('p',{'class':'z2os-muted'},_('Рейтинг появится после сбора результатов.'))));
	},

	render: function (data) {
		this.injectCss();var self=this,status=data[0]||{},preview=data[1]||{},history=data[2]||{};
		var candidates=preview.comboCatalog&&preview.comboCatalog.candidates||[],state=preview.strategyState||{},active=state.active||null,overrides=preview.overrides&&preview.overrides.rules||[];
		if(!this.pendingStrategyId)this.pendingStrategyId=active&&active.candidateId||(candidates.find(function(c){return c.recommended;})||candidates[0]||{}).managerId||null;
		var selected=candidates.find(function(c){return c.managerId===self.pendingStrategyId;})||candidates[0]||null,isRunning=running(status);
		var list=E('div',{'class':'z2os-strategy-list'});
		candidates.forEach(function(c){var row=E('button',{type:'button','class':'z2os-strategy-row'+(c.managerId===self.pendingStrategyId?' selected':'')},[E('span',{'class':'z2os-star'},c.recommended?'★':'•'),E('span',{'class':'z2os-grow'},[E('b',{},c.name),E('small',{},c.description||String(c.profileCount)+' профилей')]),active&&active.candidateId===c.managerId?badge('ВКЛЮЧЕНА','good'):c.recommended?badge('РЕКОМЕНДУЕМАЯ','purple'):badge(String(c.profileCount),'neutral')]);row.addEventListener('click',function(){self.pendingStrategyId=c.managerId;self.rerender(data);});list.appendChild(row);});
		var input=E('input',{type:'text','class':'cbi-input-text',placeholder:'store.steampowered.com или https://example.com',value:this.selectedTarget});input.addEventListener('input',function(){self.selectedTarget=input.value;});
		var runBox=E('div',{'class':'z2os-run-result'},E('p',{'class':'z2os-muted'},_('Проверка использует реальные результаты Orchestra.')));
		var testSelected=btn(_('Проверить выбранную стратегию'),'cbi-button-neutral',function(b){self.startTargetTest(false,runBox,b);},!selected);
		var testAll=btn(_('Проверить все стратегии'),'cbi-button-action',function(b){self.startTargetTest(true,runBox,b);},!candidates.length);
		var addOverride=btn(_('Применить только к ресурсу'),'cbi-button-positive',function(b){var target=normalizeTarget(self.selectedTarget);if(!selected||!target){notify(_('Выберите стратегию и укажите ресурс.'),'error');return;}self.overrideAction({action:'override_set',target:target,strategyId:selected.managerId,enabled:true,applyNow:true},b);},!selected);
		var overrideRows=overrides.length?overrides.map(function(r){var c=candidates.find(function(x){return x.managerId===r.strategyId;});return E('div',{'class':'z2os-override-row'},[E('span',{'class':'z2os-order'},String(r.priority||10)),E('span',{'class':'z2os-grow'},[E('b',{},r.target),E('small',{},c?c.name:r.strategyId)]),badge(r.enabled===false?'ВЫКЛ':'ВКЛ',r.enabled===false?'neutral':'good'),btn('×','cbi-button-negative',function(b){self.overrideAction({action:'override_delete',id:r.id,applyNow:true},b);})]);}):[E('p',{'class':'z2os-muted'},_('Точечных правил пока нет. Работает глобальная стратегия.'))];
		var recent=(history.runs||[])[0]||null;
		return E('div',{'class':'z2os-root'},[
			E('div',{'class':'z2os-titlebar'},[E('div',{},[E('h2',{},'Orchestra'),E('p',{},_('Стратегии, реальные проверки и точечные правила'))]),E('div',{'class':'z2os-mode'},[badge('Простой режим','blue'),btn('Расширенный режим','cbi-button-neutral',function(){window.location.href=L.url('admin/services/zapret2-manager/advanced');})])]),
			E('div',{'class':'z2os-top-grid'},[
				card('Состояние службы',E('div',{},[E('div',{'class':'z2os-status '+(isRunning?'ok':'off')},isRunning?'● Работает':'● Остановлен'),E('p',{'class':'z2os-muted'},'zapret2 / nfqws2'),status.error?E('p',{'class':'z2os-error'},status.error):E('span')]),'compact'),
				card('Управление обходом',E('div',{'class':'z2os-control'},[E('div',{'class':'z2os-power '+(isRunning?'on':'')},'⏻'),btn(isRunning?'Остановить обход':'Включить обход',isRunning?'cbi-button-negative':'cbi-button-positive',function(b){b.disabled=true;(isRunning?stopRpc():startRpc()).then(function(){window.location.reload();}).catch(function(e){b.disabled=false;notify(e,'error');});})]),'compact'),
				card('Активная глобальная стратегия',E('div',{},[E('h2',{},active?active.name:'Не определена'),active?badge('ВКЛЮЧЕНА','good'):badge('НЕИЗВЕСТНО','neutral'),E('p',{'class':'z2os-muted'},active?'Ревизия overrides: '+String(active.overrideRevision||0):'Выберите и примените встроенную стратегию.'),btn('Откатить','cbi-button-neutral',function(b){b.disabled=true;rollbackRpc().then(function(r){if(!r||r.ok!==true)throw r;window.location.reload();}).catch(function(e){b.disabled=false;notify(e,'error');});},!active)]),'compact'),
				card('Быстрые действия',E('div',{'class':'z2os-stack'},[btn('Проверить ресурс / адрес','cbi-button-action',function(){input.focus();}),E('span',{'class':'z2os-muted'},String(overrides.length)+' активных override')]),'compact')
			]),
			E('div',{'class':'z2os-note'},_('Количество целей приходит от backend. HTTPS-проверка не считается доказательством работы игрового UDP или голоса.')),
			E('div',{'class':'z2os-main-grid'},[
				card('Доступные стратегии ('+String(candidates.length)+')',list,'strategies'),
				card('Выбранная стратегия',selected?E('div',{'class':'z2os-details'},[E('div',{},[E('h2',{},selected.name),selected.recommended?badge('РЕКОМЕНДУЕМАЯ','purple'):E('span')]),E('p',{},selected.description||'Встроенная семипрофильная комбо-стратегия.'),E('div',{'class':'z2os-metrics'},[E('div',{},[E('strong',{},String(selected.profileCount)),E('small',{},'Профилей')]),E('div',{},[E('strong',{},selected.tcpPorts),E('small',{},'TCP')]),E('div',{},[E('strong',{},selected.udpPorts),E('small',{},'UDP')])]),btn('Применить глобально','cbi-button-positive',function(b){self.applyGlobal(selected,b);}),E('details',{},[E('summary',{},'Технические детали'),E('pre',{},JSON.stringify({id:selected.managerId,digest:selected.digest,source:selected.source},null,2))])]):E('p',{'class':'z2os-muted'},'Каталог недоступен.'),'details'),
				card('Проверить ресурс / адрес',E('div',{'class':'z2os-stack'},[input,E('div',{'class':'z2os-actions'},[testSelected,testAll]),addOverride,runBox]),'tester'),
				card('Последний результат тестирования',recent?E('div',{},[E('div',{'class':'z2os-run-head'},[badge(phaseLabel(recent.phase),recent.phase==='completed'?'good':'neutral'),E('span',{},recent.target||'—')]),E('div',{'class':'z2os-metrics'},[E('div',{},[E('strong',{},String(recent.completedCount||0)),E('small',{},'Выполнено')]),E('div',{},[E('strong',{},String(recent.candidateCount||0)),E('small',{},'Кандидатов')]),E('div',{},[E('strong',{},recent.winnerCandidateId||'—'),E('small',{},'Победитель')])]),btn('Открыть расширенные результаты','cbi-button-neutral',function(){window.location.href=L.url('admin/services/zapret2-manager/advanced');})]):E('p',{'class':'z2os-muted'},'Завершённых запусков ещё нет.'),'results'),
				card('Точечные правила override',E('div',{'class':'z2os-overrides'},overrideRows),'overrides')
			]),
			E('div',{'class':'z2os-footer'},[_('Выбор стратегии не меняет runtime до нажатия кнопки применения.'),badge('Откат доступен после применения','blue')])
		]);
	},
	handleSaveApply:null,handleSave:null,handleReset:null
});
