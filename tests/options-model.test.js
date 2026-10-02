// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOptions, displayValue, validateDraft} from '../extension/lib/ui/options-model.js';

const specs=[
    {type:'combo',key:'size',label:'尺寸',values:['small','large'],names:['小','大'],group:'外观'},
    {type:'entry',key:'scale',label:'缩放',number:{min:.5,max:3},default:1},
    {type:'switch',key:'auto',label:'自动'},
    {type:'entry',key:'city',label:'城市',sensitiveWhen:{key:'auto',equals:false}},
    {type:'search',key:'_search',label:'查找',provider:async()=>[],onPick:()=>{}},
    {type:'button',label:'定位',onClick:()=>{}},
];
const initial={size:'small',auto:true,city:'上海',moves:123,tiles:[1,2,3]};
test('GTK model serializes only presentation fields, retaining callbacks in Shell',()=>{
    const prepared=prepareOptions(specs,initial),wire=JSON.parse(JSON.stringify(prepared.fields));
    assert.equal(wire[0].group,'外观');assert.equal(wire[1].value,'1');
    assert.deepEqual(wire[3].sensitiveWhen,{key:'auto',equals:false});
    assert.equal(wire[4].provider,undefined);assert.equal(wire[5].onClick,undefined);
    assert.equal(initial.scale,undefined);assert.equal(prepared.values.scale,1);
    assert.equal(wire[5].id,'5');
});
test('native options merge edited values without overwriting runtime counters',()=>{
    const raw={size:'large',scale:'1.25',auto:false,city:'南昌',_search:'query',moves:0,tiles:[]};
    assert.deepEqual(validateDraft(specs,initial,raw),{size:'large',scale:1.25,auto:false,city:'南昌'});
    assert.equal(initial.moves,123);
});
test('native validation rejects invalid values and identifies the failing row',()=>{
    const base={size:'small',scale:'1',auto:true,city:'上海'};
    for(const [key,value] of [['size','giant'],['scale','-1'],['scale',''],['scale','NaN'],['auto','yes']]){
        assert.throws(()=>validateDraft(specs,initial,{...base,[key]:value}),error=>error.key===key);
    }
    const checked=[{type:'entry',key:'station',label:'气象站',validate:value=>{if(!/^\d+$/.test(value))throw new Error('无效编号');}}];
    assert.throws(()=>validateDraft(checked,{station:'58606'},{station:'oops'}),{message:'气象站: 无效编号',key:'station'});
});
test('formatted contact text round-trips and arrays/booleans retain their types',()=>{
    const people=[{name:'名字',phone:'123',email:'test@example.com'}];
    const entries=[{type:'entry',key:'people',multiline:true,format:value=>value.map(p=>[p.name,p.phone,p.email].join('|')).join('\n'),
        parse:text=>text.split('\n').map(line=>{const [name,phone,email]=line.split('|');return{name,phone,email};})}];
    const model=prepareOptions(entries,{people});
    assert.equal(model.fields[0].value,'名字|123|test@example.com');
    assert.deepEqual(validateDraft(entries,{people},{people:model.fields[0].value}),{});
});
test('all picker previews and selection values survive the JSON boundary',()=>{
    const spec={type:'picker',key:'image',values:Array.from({length:11},(_,i)=>i+1),preview:i=>`/assets/Images/${i}.png`};
    const field=prepareOptions([spec],{image:11}).fields[0];
    assert.equal(field.value,11);assert.equal(field.previews.length,11);assert.equal(field.previews[10],'/assets/Images/11.png');
    assert.equal(displayValue({type:'entry'},0),'0');assert.equal(displayValue({type:'switch'},false),false);
});

test('effective defaults are visible after skin changes and empty symbol-list migration',()=>{
    const fields=[{type:'picker',key:'face',values:['trad','square']},
        {type:'entry',key:'symbols',default:['600519'],format:value=>value.join('\n')}];
    const model=prepareOptions(fields,{face:'monitor',symbols:[]});
    assert.equal(model.fields[0].value,'trad');assert.equal(model.fields[1].value,'600519');
});
