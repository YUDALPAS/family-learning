import { app, render, go, esc, items } from '../app.js';

export async function login() {
  app.me = null;
  const demo = app.store.kind === 'local';
  const root = render(`
    <h1>오늘도 한 장씩</h1>
    <p class="muted">${demo ? '체험판이에요. 기록은 이 기기에만 저장돼요.' : '가족 계정으로 로그인하세요.'}</p>
    <form id="f" novalidate>
      <label class="field">아이디<input name="id" autocomplete="username" autocapitalize="none" required></label>
      <label class="field">비밀번호<input name="pw" type="password" autocomplete="current-password" required></label>
      <p class="small" id="err" style="color:var(--pen)" role="alert"></p>
      <button class="btn wide" type="submit">로그인</button>
    </form>
    ${demo ? `<h2>체험용 계정</h2>
    <ul class="list">
      <li><button class="item link" data-id="samson" style="text-decoration:none;width:100%">샘슨 (보호자, 방송대)<span class="meta">samson / 1234</span></button></li>
      <li><button class="item link" data-id="kid1" style="text-decoration:none;width:100%">첫째 (고1)<span class="meta">kid1 / 1234</span></button></li>
      <li><button class="item link" data-id="kid2" style="text-decoration:none;width:100%">둘째 (초6)<span class="meta">kid2 / 1234</span></button></li>
    </ul>` : ''}`);
  const f = root.querySelector('#f');
  const submit = async (id, pw) => {
    try {
      app.me = await app.store.signIn(id, pw);
      app.items = null; await items(true);
      go('#/home');
    } catch (e) { root.querySelector('#err').textContent = e.message; }
  };
  f.onsubmit = (e) => { e.preventDefault(); submit(f.elements.namedItem('id').value, f.elements.namedItem('pw').value); };
  root.querySelectorAll('[data-id]').forEach(b => b.onclick = () => submit(b.dataset.id, '1234'));
}
