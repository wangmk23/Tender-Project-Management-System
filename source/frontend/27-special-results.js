// ── Special result registration ──
const specialResultModes = {
    multi:'企业采购 · 多家中标或入围', shares:'份额或区域分配', framework:'框架协议 · 第一阶段入围', calloff:'框架协议 · 第二阶段成交',
    candidates:'候选人排序（历史登记）', limited:'多包兼投限中', change:'结果变更或递补', no_award:'无成交结果', pricing:'单一供应商 · 特殊报价'
};
const specialResultRoles = {winner:'中标 / 成交', shortlisted:'入围', candidate:'候选（历史登记）', previous:'原结果供应商'};
const specialPriceKinds = {unit:'单价', total:'总价', discount:'折扣率（%）', reduction:'下浮率（%）', rate:'费率（%）', other:'其他计价'};
const specialRolesByMode = {
    multi:['shortlisted','winner'], shares:['winner'], framework:['shortlisted'],
    calloff:['winner','shortlisted'], candidates:['candidate'], limited:['winner'],
    change:['previous','winner'], pricing:['winner'], no_award:['previous']
};
function specialScopeLabel(project, lotId) {
    const lot = (project.lots || []).find(row => String(row.id)===String(lotId));
    return lot ? [lot.lot_number,lot.lot_name].filter(Boolean).join(' ') : '整体项目';
}
function specialResultStageRows(project) {
    return (project.special_results || []).map(row => `<div class="biz-row"><span>${escHtml(specialScopeLabel(project,row.lot_id))} · ${escHtml(specialResultModes[row.mode] || '特殊结果')}</span><button type="button" class="btn btn-xs btn-secondary" onclick="showSpecialResultForm(${Number(row.lot_id)||'null'})">查看 / 编辑</button></div>`).join('');
}
function specialText(value) { return escHtml(String(value ?? '')); }
function specialOptions(choices, selected) {
    return Object.entries(choices).map(([key,label])=>`<option value="${specialText(key)}" ${String(key)===String(selected)?'selected':''}>${specialText(label)}</option>`).join('');
}
function specialField(label,key,value,{choices,number=false,required=false,area=false,maxLength}={}) {
    const attr=`data-key="${key}" ${required?'required':''}`;
    const control=choices?`<select ${attr}>${specialOptions(choices,value)}</select>`:area?
        `<textarea ${attr} rows="2">${specialText(value)}</textarea>`:
        `<input ${attr} ${maxLength?`maxlength="${maxLength}"`: ''} type="${number?'number':'text'}" ${number?'step="any" min="0"':''} value="${specialText(value)}">`;
    return `<label class="special-field"><span>${label}${required?' *':''}</span>${control}</label>`;
}
function specialItemHtml(item,index,unassigned=false) {
    return `<div data-item="${index}" class="special-item"><div class="special-grid">
        ${specialField('名称','name',item.name,{required:true})}${specialField('类型','kind',item.kind,{choices:{goods:'货物',service:'服务',works:'工程'}})}
        ${specialField('规格 / 服务内容','spec',item.spec)}${specialField('单位','unit',item.unit)}${specialField('数量','quantity',item.quantity,{number:true})}
        </div>${unassigned?'<button type="button" class="btn btn-xs btn-secondary" data-action="remove-item">移除未分配标的</button>':''}</div>`;
}
function specialPriceHtml(price,index,state,lastPrices) {
    const items=state.data.items;
    const itemIndex=state.itemIndices.get(price.item_id);
    const refs=state.itemPrices.get(price.item_id) || [];
    const choices={'':'供应商整体报价', ...Object.fromEntries(items.map((item,i)=>[item.id,item.name || `标的 ${i+1}`]))};
    const monetary=['unit','total'].includes(price.kind);
    const item=items[itemIndex];
    return `<fieldset data-price="${index}" class="special-price"><legend>报价明细 ${index+1}</legend>
        ${item && refs[0]===price ? ((refs.length>1?'<p>此标的的名称和规格由引用它的报价共用。</p>':'')+specialItemHtml(item,itemIndex)) : ''}
        <div class="special-grid">
        ${specialField('报价标的','item_id',price.item_id,{choices})}${specialField('计价方式','kind',price.kind,{choices:specialPriceKinds})}
        ${specialField('明细名称','detail_name',price.detail_name,{maxLength:200})}
        ${specialField(monetary?(price.kind==='unit'?'含税单价（元）':'含税报价（元）'):price.kind==='other'?'报价内容':'比例（%）','value',price.value,{number:price.kind!=='other'})}
        ${monetary?specialField('不含税报价（元）','net',price.net,{number:true})+specialField('税率（%）','tax',price.tax,{number:true}):''}
        ${specialField('计价依据','basis',price.basis)}${specialField('报价备注','notes',price.notes)}</div>
        <div class="special-actions">
        ${item && !state.historical && lastPrices.get(item.id)===price
            ? '<button type="button" class="btn btn-xs btn-secondary" data-action="add-detail">为此标的添加明细</button>' : ''}
        <button type="button" class="btn btn-xs btn-secondary" data-action="remove-price">移除本行</button></div></fieldset>`;
}
function specialEntryHtml(entry,index,state) {
    const {data,name,files,historical}=state;
    const roles=[...new Set([...(specialRolesByMode[data.mode] || []),entry.role])].filter(Boolean);
    const canAdd=['winner','shortlisted'].includes(entry.role);
    const lastPrices=new Map(entry.prices.map(price=>[price.item_id,price]));
    return `<fieldset class="special-card" data-entry="${index}"><legend>${specialText(name(entry.registration_id))}</legend><div class="special-grid">
        ${specialField('结果身份','role',entry.role,{choices:Object.fromEntries(roles.map(key=>[key,specialResultRoles[key]]))})}
        ${['candidates','limited','change','multi','framework'].includes(data.mode)?specialField('排名','rank',entry.rank,{number:true}):''}
        ${data.mode==='shares'?specialField('分配份额（%）','share',entry.share,{number:true})+specialField('服务区域','region',entry.region):''}
        ${specialField('供应商备注','notes',entry.notes)}</div>
        ${!['candidates','no_award'].includes(data.mode) && (canAdd || entry.prices.length)? `<h4>本家采购标的与报价</h4>
        <div>${entry.prices.map((price,i)=>specialPriceHtml(price,i,state,lastPrices)).join('')}</div>
        ${canAdd?`<div class="special-actions"><button type="button" class="btn btn-sm btn-primary" data-action="add-item">添加货物或服务</button>
        ${data.items.some(item=>!entry.prices.some(price=>price.item_id===item.id))?'<button type="button" class="btn btn-sm btn-secondary" data-action="fill-prices">引用全部尚未添加的标的</button>':''}
        <button type="button" class="btn btn-sm btn-secondary" data-action="add-price">添加报价行</button></div>`:''}`:''}
        ${historical?'':`<label class="special-field"><span>该供应商的结果附件</span><input type="file" multiple data-files></label><div class="special-files" data-files-list="${entry.registration_id}">${files(entry.registration_id)}</div>`}
        </fieldset>`;
}
function specialEditorHtml(state) {
    const {data,name,registrations,versions,historical}=state;
    const mode=data.mode;
    const modes=Object.fromEntries(Object.entries(specialResultModes).filter(([key])=>key!=='candidates' || mode==='candidates'));
    state.itemIndices=new Map(data.items.map((item,i)=>[item.id,i]));
    state.itemPrices=new Map();
    for(const entry of data.entries) for(const price of entry.prices) {
        if(!state.itemPrices.has(price.item_id)) state.itemPrices.set(price.item_id,[]);
        state.itemPrices.get(price.item_id).push(price);
    }
    const unassigned=data.items.filter(item=>!state.itemPrices.has(item.id));
    const ids=[...new Set([...registrations.map(reg=>reg.id),...data.entries.map(entry=>entry.registration_id)])];
    return `<div>${versions.length?`<label class="special-field"><span>记录版本</span><select data-history>${specialOptions({'':'当前版本',...Object.fromEntries(versions.map(row=>[row.revision,`第 ${row.revision} 版 · ${specialResultModes[row.mode] || ''}`]))},historical?data.revision:'')}</select></label>`:''}</div>
        <fieldset class="special-body" ${historical?'disabled':''}><label class="special-field"><span>结果情形</span><select data-mode>${specialOptions({'':'请选择结果情形',...modes},mode)}</select></label>
        ${!mode?'':`<div class="special-content">
        ${mode==='no_award' && !data.entries.length?'':`<section><h3>${['multi','framework'].includes(mode)?'选择入围或中标供应商（可多选）':'选择供应商'}</h3><div class="special-checks">${ids.map(id=>`<label><input type="checkbox" data-supplier="${id}" ${mode==='candidates' && !data.entries.some(e=>e.registration_id===id)?'disabled':''} ${data.entries.some(e=>e.registration_id===id)?'checked':''}> ${specialText(name(id))}</label>`).join('') || '<p>当前范围没有可选供应商，请先核对报名和有效投标名单。</p>'}</div>${data.entries.map((entry,i)=>specialEntryHtml(entry,i,state)).join('')}</section>`}
        ${data.entries.some(entry=>['winner','shortlisted'].includes(entry.role)) && unassigned.length?`<section><h3>尚未分配给供应商的标的</h3>${unassigned.map(item=>specialItemHtml(item,state.itemIndices.get(item.id),true)).join('')}</section>`:''}
        ${specialField(['change','no_award'].includes(mode)?'处理原因':'结果备注','notes',data.notes,{area:true,required:['change','no_award'].includes(mode)})}</div>`}
        </fieldset><p class="special-status" role="status" aria-live="polite"></p>`;
}
async function showSpecialResultForm(lotId) {
    const project=currentProject;
    if(hasInlineOnlineBidding(project)) return;
    const lots=project.lots || [];
    if(lotId===undefined && lots.length>1) {
        const choices=Object.fromEntries(lots.map(lot=>[lot.id,specialScopeLabel(project,lot.id)]));
        showModal('选择特殊结果所属采购包',`<label class="special-field"><span>采购包</span><select id="specialLot">${specialOptions(choices,lots[0].id)}</select></label>`,()=>showSpecialResultForm(document.getElementById('specialLot').value),{saveLabel:'继续'});
        return;
    }
    const lot=lotId===undefined?(lots[0]?.id ?? ''):(lotId ?? '');
    const path=`/api/projects/${project.id}/special-results`;
    const scope=`?lot_id=${encodeURIComponent(lot)}`;
    const url=path+scope+'&format=mode';
    const fileUrl=rid=>`${path}/registrations/${rid}/attachments${scope}`;
    const root=document.createElement('div');
    root.className='special-results';
    let data=null, latest=null, historical=false, dirty=false, busy=false, needsRefresh=false;
    let nextItem=1;
    const pending=new Map(), attachments=new Map(), fileErrors=new Map();
    const isCurrent=()=>root.isConnected && currentProject?.id===project.id;
    const name=rid=>{
        const reg=(project.registrations || []).find(row=>row.id===rid);
        return reg?registrationSupplierLabel(reg):`历史供应商 #${rid}`;
    };
    const hasPending=()=>[...pending.values()].some(files=>files.length);
    const discard=()=>!(dirty || hasPending()) || confirmDialog('离开特殊结果登记','尚有修改或待上传文件，确定放弃？','放弃');
    const status=message=>{
        const target=root.querySelector('[role="status"]');
        if(target) target.textContent=message;
    };
    showModal(`特殊结果登记 · ${specialScopeLabel(project,lot)}`,'<div id="specialResultHost"></div>',save,{
        wide:true,beforeClose:async()=>{
            if(busy || !await discard()) return false;
            if(needsRefresh && currentProject?.id===project.id) {await refreshProject(); reopenBidResultStage();}
            return true;
        }
    });
    document.getElementById('specialResultHost').append(root);
    root.textContent='正在读取结果…';
    async function load(revision) {
        const record=await api('GET',url+(revision?`&revision=${Number(revision)}`:''));
        if(!isCurrent()) return;
        historical=Boolean(revision);
        if(!historical) latest=record;
        data={revision:record.revision,mode:record.revision?record.mode:'',notes:record.notes || '',items:record.items || [],entries:record.entries || []};
        pending.clear();
        dirty=false;
        render();
        if(!historical) for(const entry of data.entries) loadFiles(entry.registration_id);
    }
    function filesHtml(rid) {
        return (attachments.get(rid) || []).map(file=>`<button type="button" class="btn btn-xs btn-secondary" data-action="download" data-account-permission="export_data" data-file="${Number(file.id)}">${specialText(file.filename)}</button>`).join(' ') +
            (pending.get(rid) || []).map(file=>`<span>待上传 · ${specialText(file.name)}</span>`).join(' ') +
            (fileErrors.has(rid)?`<span role="alert">${specialText(fileErrors.get(rid))}</span><button type="button" class="btn btn-xs btn-secondary" data-action="list-files">重新读取附件</button>`:'');
    }
    function refreshFiles(rid) {
        const list=root.querySelector(`[data-files-list="${rid}"]`);
        if(list) list.innerHTML=filesHtml(rid);
    }
    async function loadFiles(rid) {
        try {
            const result=await api('GET',fileUrl(rid));
            attachments.set(rid,result.attachments);
            fileErrors.delete(rid);
        } catch(error) {fileErrors.set(rid,`读取附件失败：${error.message}`);}
        refreshFiles(rid);
    }
    async function downloadFile(aid) {
        try {
            if(typeof isDesktopApp==='function' && isDesktopApp()) {
                const result=await api('POST',`/api/attachments/${aid}/save-local`,{});
                const info=`已保存：${result.path || result.filename || ''}`;
                status(info);
                toast(info,'success');
                return;
            }
            const link=document.createElement('a');
            link.href=`/api/attachments/${aid}/download`;
            link.download='';
            document.body.append(link);
            link.click();
            link.remove();
            status('已交给浏览器下载');
            toast('已交给浏览器下载','success');
        } catch(error) {
            const info=`下载失败：${error.message}`;
            status(info);
            toast(info,'error');
        }
    }
    function render(focusSelector) {
        const versions=(latest.history || []).filter(row=>row.revision<latest.revision);
        root.innerHTML=specialEditorHtml({data,name,files:filesHtml,historical,versions,registrations:eligibleBidRegistrations(project,lot)});
        const button=document.getElementById('modalSaveBtn');
        if(button) button.hidden=historical;
        if(focusSelector) root.querySelector(focusSelector)?.focus();
    }
    function positions(target) {
        const item=target.closest('[data-item]')?.dataset.item;
        const entry=target.closest('[data-entry]')?.dataset.entry;
        const price=target.closest('[data-price]')?.dataset.price;
        return {item,entry:data.entries[entry],entryIndex:entry,price};
    }
    function updateField(target) {
        const {item,entry,price}=positions(target);
        const row=item!==undefined?data.items[item]:price!==undefined?entry.prices[price]:entry || data;
        const key=target.dataset.key;
        const value=target.value;
        row[key]=target.type==='number' && value===''?null:value;
        dirty=true;
        if(key==='name' && item!==undefined) {
            for(const option of root.querySelectorAll('[data-key="item_id"] option')) {
                if(option.value===row.id) option.textContent=value || `标的 ${Number(item)+1}`;
            }
        }
    }
    root.addEventListener('input',event=>{
        if(!busy && !historical && event.target.matches('[data-key]')) updateField(event.target);
    });
    root.addEventListener('change',async event=>{
        if(busy) return;
        const target=event.target;
        if(target.matches('[data-history]')) {
            if(!await discard()) {target.value=historical?String(data.revision):'';return;}
            busy=true;
            root.inert=true;
            try {await load(target.value);}
            catch(error) {target.value=historical?String(data.revision):'';status(error.message);}
            finally {busy=false;root.inert=false;}
            return;
        }
        if(historical) return;
        if(target.matches('[data-key]')) {
            updateField(target);
            const {item,entry,entryIndex,price}=positions(target);
            if(item!==undefined) return;
            if(target.dataset.key==='role' || target.dataset.key==='item_id') {
                render(`[data-entry="${entryIndex}"] ${price!==undefined?`[data-price="${price}"] `:''}[data-key="${target.dataset.key}"]`);
            } else if(price!==undefined && target.dataset.key==='kind') {
                if(!['unit','total'].includes(target.value)) Object.assign(entry.prices[price],{net:null,tax:null});
                if(target.value!=='other' && !Number.isFinite(Number(entry.prices[price].value))) entry.prices[price].value=null;
                render(`[data-entry="${entryIndex}"] [data-price="${price}"] > .special-grid [data-key="kind"]`);
            }
            return;
        }
        if(target.matches('[data-files]')) {
            const rid=positions(target).entry.registration_id;
            pending.set(rid,[...(pending.get(rid) || []),...target.files]);
            target.value='';
            refreshFiles(rid);
        } else if(target.matches('[data-mode]')) {
            const mode=target.value;
            if(!mode || (data.entries.length && !await confirmDialog('切换结果情形','将按照新的结果情形调整供应商身份。继续切换？','切换'))) {
                target.value=data.mode;
                return;
            }
            const roles=specialRolesByMode[mode];
            data.mode=mode;
            for(const entry of data.entries) {
                if(entry.role!=='candidate' && !roles.includes(entry.role)) entry.role=roles[0];
                if(mode==='no_award' || mode==='candidates') entry.prices=[];
                if(mode!=='shares') {entry.share=null;entry.region='';}
            }
            if(mode==='no_award' || mode==='candidates') data.items=[];
            dirty=true;
            render('[data-mode]');
        } else if(target.matches('[data-supplier]')) {
            const rid=Number(target.dataset.supplier);
            if(target.checked) data.entries.push({registration_id:rid,role:specialRolesByMode[data.mode][0],prices:[]});
            else {
                if(!await confirmDialog('移除供应商',`从本次登记移除${name(rid)}及其报价？`,'移除')) {target.checked=true;return;}
                const removedIds=new Set(data.entries.find(e=>e.registration_id===rid).prices.map(p=>p.item_id));
                data.entries=data.entries.filter(e=>e.registration_id!==rid);
                data.items=data.items.filter(item=>!removedIds.has(item.id) || data.entries.some(e=>e.prices.some(p=>p.item_id===item.id)));
                pending.delete(rid);
            }
            dirty=true;
            render(`[data-supplier="${rid}"]`);
        }
    });
    root.addEventListener('click',async event=>{
        const target=event.target.closest('[data-action]');
        if(!target || busy || historical) return;
        const {item,entry,entryIndex,price}=positions(target);
        const action=target.dataset.action;
        if(action==='download') {await downloadFile(Number(target.dataset.file));return;}
        if(action==='list-files') {await loadFiles(entry.registration_id);return;}
        let focus;
        if(action==='add-item') {
            let id;
            do {id=`item-${nextItem++}`;} while(data.items.some(row=>row.id===id));
            data.items.push({id,name:'',kind:'goods',spec:'',unit:'',quantity:null});
            entry.prices.push({item_id:id,kind:'unit',value:null,net:null,tax:null,basis:'',notes:''});
            focus=`[data-item="${data.items.length-1}"] input`;
        } else if(action==='remove-item') {
            if(!await confirmDialog('移除未分配标的','确定移除这个尚未分配的标的？','移除')) return;
            data.items.splice(item,1);
            focus='[data-action="add-item"]';
        } else if(action==='add-price' || action==='add-detail') {
            const previous=entry.prices[price ?? entry.prices.length-1];
            const itemId=previous?.item_id || '';
            entry.prices.push({item_id:itemId,kind:itemId?previous.kind:'total',value:null,net:null,tax:null,basis:'',notes:''});
            focus=`[data-entry="${entryIndex}"] [data-price="${entry.prices.length-1}"] [data-key="detail_name"]`;
        } else if(action==='fill-prices') {
            const missing=data.items.filter(row=>!entry.prices.some(price=>price.item_id===row.id));
            if(!missing.length) {status('该供应商已有全部标的的报价行。');return;}
            entry.prices.push(...missing.map(row=>({item_id:row.id,kind:'unit',value:null,net:null,tax:null,basis:'',notes:''})));
            focus=`[data-entry="${entryIndex}"] [data-price="${entry.prices.length-missing.length}"] [data-key="value"]`;
        } else if(action==='remove-price') {
            const [removed]=entry.prices.splice(price,1);
            if(removed.item_id && !data.entries.some(row=>row.prices.some(p=>p.item_id===removed.item_id))) {
                data.items=data.items.filter(row=>row.id!==removed.item_id);
            }
            focus=`[data-entry="${entryIndex}"] [data-action="add-price"]`;
        } else return;
        dirty=true;
        render(focus);
    });
    async function save() {
        if(!data || busy || historical) return false;
        if(!data.mode) {status('请选择结果情形。');root.querySelector('[data-mode]').focus();return false;}
        if(!data.entries.length && data.mode!=='no_award') {status('请先选择供应商。');return false;}
        const invalid=root.querySelector(':invalid:not(fieldset)');
        if(invalid) {invalid.reportValidity();return false;}
        let savingFiles=false;
        busy=true;
        root.inert=true;
        try {
            if(dirty || !data.revision) {
                // Number the submitted rows in supplier order so edits to the item or pricing method cannot collide.
                const entries=data.entries.map(entry=>({...entry,prices:entry.prices.map((price,index)=>({...price,line_no:index+1}))}));
                const saved=await api('PUT',url,{...data,entries});
                data.revision=saved.revision;
                latest=saved;
                dirty=false;
                needsRefresh=true;
            }
            savingFiles=true;
            for(const [rid,files] of pending) {
                if(!files.length) continue;
                const form=new FormData();
                files.forEach(file=>form.append('files',file));
                const uploaded=await apiForm(fileUrl(rid),form);
                attachments.set(rid,uploaded.attachments);
                pending.delete(rid);
                refreshFiles(rid);
            }
            closeModal.beforeClose=null;
            closeModal();
            await refreshProject();
            reopenBidResultStage();
            toast('特殊结果已保存','success');
        } catch(error) {
            const info=savingFiles && hasPending()?`结果已保存，附件上传失败。请再次保存以重试剩余文件。${error.message}`:error.message;
            status(info);
            toast(info,'error');
        } finally {busy=false;root.inert=false;}
        return false;
    }
    try {
        if(!project.tender_guarantee && typeof loadTenderGuarantee==='function') await loadTenderGuarantee(project);
        await load();
    } catch(error) {if(isCurrent()) root.textContent=`读取失败：${error.message}。请关闭后重新打开。`;}
}
