// 构建加密版 index.html。
// 读取明文源 index.plain.html，把「题库 + 应用逻辑」用密码加密（AES-256-GCM，
// 密钥由 PBKDF2-SHA256 从密码派生），输出仅含密文与密码界面的 index.html。
// 未输入正确密码时，页面里没有任何可读的题目/答案，无法绕过。
//
// 用法：node build.js
// 改题流程：编辑 index.plain.html → node build.js → 提交 index.html。

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const PASSWORD = "101300";
const ITERATIONS = 250000;
const ROOT = __dirname;

const plain = fs.readFileSync(path.join(ROOT, "index.plain.html"), "utf8");

// 提取样式块（非机密，明文保留）
const styleMatch = plain.match(/<style>[\s\S]*?<\/style>/);
if (!styleMatch) throw new Error("找不到 <style> 块");
const styleBlock = styleMatch[0];

// 提取题库 JSON
const jsonMatch = plain.match(/<script id="question-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!jsonMatch) throw new Error("找不到题库 JSON");
const jsonText = jsonMatch[1].trim();
JSON.parse(jsonText); // 校验合法

// 提取应用脚本（最后一个普通 <script>...</script>）
const appMatch = plain.match(/<script>\n"use strict";([\s\S]*?)<\/script>\s*<\/body>/);
if (!appMatch) throw new Error("找不到应用脚本");
let appBody = appMatch[1];

// 把「从 DOM 读取题库」替换为内联字面量（加密后 DOM 里不再有题库元素）
const needle = 'const QUESTIONS = JSON.parse(document.getElementById("question-data").textContent);';
if (!appBody.includes(needle)) throw new Error("找不到 QUESTIONS 读取行");
appBody = appBody.replace(needle, `const QUESTIONS = ${jsonText};`);

// 待加密载荷：完整可执行的 JS
const payload = `"use strict";${appBody}`;

// 加密
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(PASSWORD, salt, ITERATIONS, 32, "sha256");
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
const blob = Buffer.concat([ct, tag]); // 浏览器 WebCrypto 需要 密文||认证标签

const b64 = (b) => b.toString("base64");

const out = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>供应链管理复习答题</title>
${styleBlock}
<style>
#lock{max-width:420px;margin:0 auto;padding:64px 20px;text-align:center}
#lock h1{font-size:1.3rem;margin:0 0 6px}
#lock p{color:var(--muted);font-size:.9rem;margin:0 0 24px}
#lock .pwbox{background:var(--card);border:1px solid var(--line);border-radius:16px;
  padding:22px 20px;box-shadow:0 1px 3px rgba(20,30,60,.06)}
#lock input{width:100%;font:inherit;font-size:1.15rem;letter-spacing:.3em;text-align:center;
  padding:13px 14px;border:1.5px solid var(--line);border-radius:12px;background:#fff;color:var(--ink)}
#lock input:focus{outline:none;border-color:var(--blue)}
#lock button{width:100%;margin-top:12px;padding:14px;border-radius:12px;font-size:1rem;
  font-weight:600;background:var(--blue);color:#fff;border:none;cursor:pointer}
#lock button:disabled{opacity:.55;cursor:default}
#lock .err{color:var(--red);font-size:.88rem;margin-top:12px;min-height:1.2em}
#lock .lockicon{font-size:2.4rem;margin-bottom:10px}
</style>
</head>
<body>
<div id="lock">
  <div class="lockicon">🔒</div>
  <h1>供应链管理复习答题</h1>
  <p>请输入密码后开始答题</p>
  <div class="pwbox">
    <input id="pw" type="password" inputmode="numeric" autocomplete="off" placeholder="请输入密码" aria-label="密码">
    <button id="unlock">进入答题</button>
    <div class="err" id="err"></div>
  </div>
</div>
<div id="app" style="display:none"></div>
<script>
"use strict";
(function(){
  var SALT = "${b64(salt)}", IV = "${b64(iv)}", DATA = "${b64(blob)}", ITER = ${ITERATIONS};
  function b64ToBuf(s){ var bin = atob(s), n = bin.length, u = new Uint8Array(n); for(var i=0;i<n;i++) u[i]=bin.charCodeAt(i); return u; }
  var lock = document.getElementById("lock"),
      app = document.getElementById("app"),
      pw = document.getElementById("pw"),
      btn = document.getElementById("unlock"),
      err = document.getElementById("err");

  if(!(window.crypto && window.crypto.subtle)){
    err.textContent = "当前浏览器不支持解密，请用较新的浏览器（需 HTTPS）。";
    btn.disabled = true;
  }

  async function unlock(){
    err.textContent = "";
    var pass = pw.value.trim();
    if(!pass){ err.textContent = "请输入密码"; return; }
    btn.disabled = true; btn.textContent = "解锁中…";
    try{
      var enc = new TextEncoder();
      var km = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
      var key = await crypto.subtle.deriveKey(
        {name:"PBKDF2", salt:b64ToBuf(SALT), iterations:ITER, hash:"SHA-256"},
        km, {name:"AES-GCM", length:256}, false, ["decrypt"]);
      var ptBuf = await crypto.subtle.decrypt({name:"AES-GCM", iv:b64ToBuf(IV)}, key, b64ToBuf(DATA));
      var js = new TextDecoder().decode(ptBuf);
      lock.parentNode.removeChild(lock);
      app.style.display = "";
      (0, eval)(js); // 运行解密后的应用（内部会渲染到 #app）
    }catch(e){
      btn.disabled = false; btn.textContent = "进入答题";
      err.textContent = "密码错误，请重试";
      pw.value = ""; pw.focus();
    }
  }
  btn.addEventListener("click", unlock);
  pw.addEventListener("keydown", function(e){ if(e.key === "Enter") unlock(); });
  pw.focus();
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "index.html"), out, "utf8");
console.log("已生成加密 index.html：密文 " + blob.length + " 字节，迭代 " + ITERATIONS + " 次。");
