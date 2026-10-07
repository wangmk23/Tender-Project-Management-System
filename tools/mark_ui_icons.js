// Mark decorative interface icons explicitly; never transform business text.
const fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const glyph=/[\u{1F000}-\u{1FAFF}\u2600-\u27BF][\uFE0F]?/gu;
function markStatic(raw,state){let result='',i=0;while(i<raw.length){const c=raw[i];if(c==='<')state.tag=true;if(state.tag){if(state.quote){if(c===state.quote)state.quote=null;}else if(c==='"'||c==="'")state.quote=c;else if(c==='>')state.tag=false;result+=c;i++;continue;}glyph.lastIndex=i;const m=glyph.exec(raw);if(m&&m.index===i){result+=`<span data-ui-icon='${m[0]}'></span>`;i+=m[0].length;}else{result+=c;i++;}}return result;}
function isIconExpression(expr){
 if(expr.type==='CallExpression'&&expr.callee.name==='escHtml')return isIconExpression(expr.arguments[0]);
 if(expr.type==='MemberExpression'&&expr.property.name==='icon')return true;
 if(expr.type==='Identifier'&&expr.name==='icon')return true;
 if(expr.type==='MemberExpression'&&expr.object.name==='METHOD_ICONS')return true;
 if(expr.type==='ConditionalExpression')return [expr.consequent,expr.alternate].every(e=>e.type==='Literal'&&typeof e.value==='string'&&/^[\u{1F000}-\u{1FAFF}\u2600-\u27BF][\uFE0F]?$/u.test(e.value));
 return false;
}
function rewrite(file){const source=fs.readFileSync(file,'utf8'),ast=acorn.parse(source,{ecmaVersion:'latest'}),changes=[];
function walk(n){if(!n||typeof n!=='object')return;if(n.type==='Literal'&&typeof n.value==='string'&&/<[a-z]/i.test(n.value)&&glyph.test(n.value)){glyph.lastIndex=0;const text=markStatic(n.value,{tag:false,quote:null});if(text!==n.value)changes.push([n.start,n.end,JSON.stringify(text)]);return;}glyph.lastIndex=0;
if(n.type==='TemplateLiteral'&&n.quasis.some(q=>/<[a-z]/i.test(q.value.raw))){const state={tag:false,quote:null};for(let i=0;i<n.quasis.length;i++){const q=n.quasis[i];const text=markStatic(q.value.raw,state);if(text!==q.value.raw)changes.push([q.start,q.end,text]);if(i<n.expressions.length){const expr=n.expressions[i],text=source.slice(expr.start,expr.end);const before=source.slice(n.start,q.end);const option=before.lastIndexOf('<option')>before.lastIndexOf('</option');const alreadySlot=before.lastIndexOf('data-ui-icon=')>before.lastIndexOf('>');if(!state.tag&&!option&&!alreadySlot&&isIconExpression(expr)){const value=text.startsWith('escHtml(')?text:`escHtml(${text})`;changes.push([expr.start-2,expr.end+1,`<span data-ui-icon="\${${value}}"></span>`]);}else walk(expr);}}return;}
for(const value of Object.values(n)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);changes.sort((a,b)=>b[0]-a[0]);let output=source,last=source.length;for(const [start,end,text]of changes){if(end>last)throw new Error('overlapping icon edits in '+file);output=output.slice(0,start)+text+output.slice(end);last=start;}if(changes.length)fs.writeFileSync(file,output);return changes.length;}
let count=0;for(const file of fs.readdirSync('source/frontend'))if(file.endsWith('.js')&&file!=='00-icons.js')count+=rewrite(path.join('source/frontend',file));
console.log('Explicit icon slots marked:',count);
