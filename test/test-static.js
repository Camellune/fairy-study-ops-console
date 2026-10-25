/* 静态检查器的自测：故意造假代码，验证它真能抓出问题（不能是永远通过的摆设） */
const { stripCommentsAndStrings, findUndefinedCalls, findRenderCrossCalls, extractFnBody } = require('./static-check.js');

let fail = 0;
const ck = (n, c, x = '') => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); if (!c) fail++; };

/* --- 剥离器 --- */
ck('剥离行注释', !stripCommentsAndStrings('var a=1; // foo(bar)').includes('foo'));
ck('剥离块注释', !stripCommentsAndStrings('/* call(x) */ var a=1').includes('call'));
ck('剥离单引号字符串', !stripCommentsAndStrings("var s='evil()';").includes('evil'));
ck('剥离双引号字符串', !stripCommentsAndStrings('var s="evil()";').includes('evil'));
ck('剥离模板字符串', !stripCommentsAndStrings('var s=`evil() ${x}`;').includes('evil'));
ck('保留真实代码', stripCommentsAndStrings('function f(){ return 1; }').includes('function f'));
ck('剥离含转义引号的字符串', !stripCommentsAndStrings('var s="a\\"b(c)";').includes('b(c)'));
ck('剥离正则字面量', !stripCommentsAndStrings('var r=/foo(bar)/g;').includes('foo(bar)'));
ck('不把除号误判为正则', stripCommentsAndStrings('var x = a / b / c;').includes('a / b / c'));

/* --- 未定义调用检测 --- */
const G = ['OPS'];
ck('抓到真未定义函数', findUndefinedCalls(['function a(){ ghostFn(); }'], G).includes('ghostFn'));
ck('注释里的名字不误报', findUndefinedCalls(['function a(){ /* ghostFn() */ return 1; }'], G).length === 0);
ck('字符串里的名字不误报', findUndefinedCalls(['function a(){ var s="ghostFn()"; return s; }'], G).length === 0);
ck('已定义函数不误报', findUndefinedCalls(['function a(){ b(); } function b(){}'], G).length === 0);
ck('内置对象不误报', findUndefinedCalls(['function a(){ Math.round(1); JSON.parse("{}"); localStorage.getItem("k"); }'], G).length === 0);
ck('函数参数不误报', findUndefinedCalls(['function a(cb){ cb(); }'], G).length === 0);
ck('箭头函数参数不误报', findUndefinedCalls(['var f=(item)=>{ item(); };'], G).length === 0);
ck('var 定义的函数变量不误报', findUndefinedCalls(['var h=function(){}; function a(){ h(); }'], G).length === 0);
ck('对象方法调用不误报', findUndefinedCalls(['function a(){ OPS.buildXlsx(); }'], G).length === 0);
ck('业务全局不误报', findUndefinedCalls(['function a(){ OPS.run(); }'], G).length === 0);

/* --- 函数体提取 --- */
const src = 'function renderA(){ if(1){ go(); } }\nfunction renderB(x){ return x; }';
ck('提取函数体正确（含嵌套块）', extractFnBody(src, 'renderA').includes('go()'));
ck('提取不会越界到下一个函数', !extractFnBody(src, 'renderA').includes('renderB'));
ck('提取空函数体', extractFnBody('function f(){}', 'f').trim() === '');

/* --- 渲染互调检测 --- */
ck('抓到双向互调（2 处）', findRenderCrossCalls('function renderA(){ renderB(); } function renderB(){ renderA(); }').length === 2);
ck('单向互调同样违规（铁律9）', findRenderCrossCalls('function renderA(){ renderB(); } function renderB(){}').length === 1);
ck('缩进在 IIFE 内也能正确判定',
  findRenderCrossCalls('(function(){\n  function renderA(){ renderB(); }\n  function renderB(){ return 1; }\n})();').length === 1);
ck('仅注释提到不算互调', findRenderCrossCalls(
  'function renderA(){ /* renderB(); */ return 1; } function renderB(){ return 2; }'
).length === 0);

console.log(fail === 0 ? '\n检查器自测全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);