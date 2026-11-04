(() => {
  "use strict";
  const { supabaseUrl, supabaseKey } = window.WICHTEL_CONFIG;
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");
  const BASE = location.origin + location.pathname;
  const STORE_KEY = "wichteln.v1";

  // ---------- Helfer ----------
  async function rpc(fn, args = {}) {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && (data.message || data.hint)) || "Etwas ist schiefgelaufen");
    return data;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const h = (html) => { app.innerHTML = html; window.scrollTo(0, 0); };
  const $ = (sel) => app.querySelector(sel);
  const $$ = (sel) => [...app.querySelectorAll(sel)];

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Link kopiert"); }
    catch { prompt("Zum Kopieren:", text); }
  }

  // Teilen: auf dem Handy das System-Teilen-Menü (Signal, Mail, SMS…), sonst Text + Link kopieren
  async function share(text, url) {
    const full = url ? `${text}\n${url}` : text;
    if (navigator.share) {
      try { await navigator.share(url ? { text, url } : { text }); return; }
      catch (err) { if (err && err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(full); toast("Nachricht kopiert – jetzt z.B. in Signal einfügen"); }
    catch { prompt("Zum Kopieren:", full); }
  }
  const shareAttrs = (text, url) => `data-share-text="${esc(text)}" data-share-url="${esc(url)}"`;

  const links = {
    join: (code) => `${BASE}#/g/${code}`,
    me: (token) => `${BASE}#/me/${token}`,
    admin: (token) => `${BASE}#/admin/${token}`,
  };

  // Lokale "Meine Gruppen"
  function store() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { groups: [] }; } catch { return { groups: [] }; } }
  function remember(entry) {
    try {
      const s = store();
      const same = (g) => (entry.me && g.me === entry.me) || (entry.admin && g.admin === entry.admin);
      const existing = s.groups.find(same) || {};
      s.groups = s.groups.filter((g) => !same(g));
      s.groups.unshift({ ...existing, ...entry });
      s.groups = s.groups.slice(0, 20);
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {}
  }
  function forget(key) {
    try {
      const s = store();
      s.groups = s.groups.filter((g) => g.me !== key && g.admin !== key);
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch {}
  }

  function metaPills(g) {
    const p = [];
    if (g.budget) p.push(`<span class="pill">💶 ${esc(g.budget)}</span>`);
    if (g.event_date) p.push(`<span class="pill">📅 ${esc(g.event_date)}</span>`);
    return p.length ? `<div class="meta">${p.join("")}</div>` : "";
  }

  function errorView(msg) {
    h(`<div class="card center"><h2>Hoppla</h2><p class="muted">${esc(msg)}</p><a class="btn" href="#/">Zur Startseite</a></div>`);
  }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.textContent = label || "…"; }
    else { btn.disabled = false; btn.innerHTML = btn.dataset.label || btn.innerHTML; }
  }

  // ---------- Startseite ----------
  function homeView() {
    const mine = store().groups;
    h(`
      <section class="hero">
        <h1>Wichteln für die ganze Familie</h1>
        <p>Gruppe anlegen, Link verschicken, alle tragen sich ein – und dann wird gelost. Jeder sieht nur, wen er selbst beschenkt.</p>
      </section>

      ${mine.length ? `
      <div class="card">
        <h2>Deine Gruppen</h2>
        <ul class="list">
          ${mine.map((g) => `
            <li>
              <span class="name">${esc(g.groupName || "Gruppe")}${g.name ? ` <span class="muted">· ${esc(g.name)}</span>` : ""}</span>
              <span class="actions">
                ${g.me ? `<a class="btn small ghost" href="#/me/${esc(g.me)}">Mein Wichtel</a>` : ""}
                ${g.admin ? `<a class="btn small ghost" href="#/admin/${esc(g.admin)}">Verwalten</a>` : ""}
              </span>
            </li>`).join("")}
        </ul>
      </div>` : ""}

      <div class="card">
        <h2>Neue Wichtelgruppe</h2>
        <form id="create">
          <div id="err"></div>
          <div class="field">
            <label for="gname">Name der Gruppe</label>
            <input id="gname" required maxlength="80" placeholder="z.B. Familie Weihnachten 2026">
          </div>
          <div class="field">
            <label for="aname">Dein Name <span class="hint">– du machst selbst mit</span></label>
            <input id="aname" required maxlength="60" placeholder="z.B. Titi" autocomplete="given-name">
          </div>
          <div class="row stack">
            <div class="field">
              <label for="budget">Budget <span class="hint">(optional)</span></label>
              <input id="budget" maxlength="40" placeholder="z.B. 25 €">
            </div>
            <div class="field">
              <label for="date">Bescherung <span class="hint">(optional)</span></label>
              <input id="date" maxlength="40" placeholder="z.B. 24.12. bei Oma">
            </div>
          </div>
          <div class="field">
            <label for="msg">Nachricht an alle <span class="hint">(optional)</span></label>
            <textarea id="msg" maxlength="500" placeholder="z.B. Bitte nur selbstgemachte oder gebrauchte Geschenke 🌲"></textarea>
          </div>
          <button class="btn block" type="submit">Gruppe erstellen</button>
        </form>
      </div>

      <div class="card">
        <h2>Einladung bekommen?</h2>
        <form id="joincode" class="linkbox">
          <input id="code" placeholder="Code, z.B. K7QH2M" maxlength="12" autocapitalize="characters" aria-label="Gruppencode">
          <button class="btn ghost" type="submit">Beitreten</button>
        </form>
      </div>
    `);

    $("#create").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      busy(btn, true, "Wird erstellt…");
      try {
        const name = $("#gname").value, me = $("#aname").value;
        const r = await rpc("create_group", {
          p_name: name, p_admin_name: me,
          p_budget: $("#budget").value, p_event_date: $("#date").value, p_message: $("#msg").value,
        });
        remember({ groupName: name.trim(), name: me.trim(), admin: r.admin_token, me: r.participant_token, code: r.join_code });
        location.hash = `#/admin/${r.admin_token}?neu=1`;
      } catch (err) {
        $("#err").innerHTML = `<div class="error">${esc(err.message)}</div>`;
        busy(btn, false);
      }
    });
    $("#joincode").addEventListener("submit", (e) => {
      e.preventDefault();
      const c = $("#code").value.trim().toUpperCase();
      if (c) location.hash = `#/g/${c}`;
    });
  }

  // ---------- Beitreten ----------
  async function joinView(code) {
    let g;
    try { g = await rpc("get_group", { p_join_code: code }); }
    catch (err) { return errorView(err.message); }

    const known = store().groups.find((x) => x.code === code && x.me);

    h(`
      <div class="card">
        <p class="muted" style="margin-bottom:4px">Du bist eingeladen zu</p>
        <h1>${esc(g.name)}</h1>
        ${metaPills(g)}
        ${g.message ? `<p class="wishlist-text">${esc(g.message)}</p>` : ""}
      </div>

      ${known ? `<div class="notice">Du bist in dieser Gruppe schon als <strong>${esc(known.name)}</strong> angemeldet. <a href="#/me/${esc(known.me)}">Zu deiner Seite →</a></div>` : ""}

      ${g.drawn ? `
        <div class="card"><p>Die Auslosung hat schon stattgefunden. Wenn du mitmachst, schickt dir der Organisator deinen persönlichen Link.</p></div>
      ` : `
      <div class="card">
        <h2>Mitmachen</h2>
        <form id="join">
          <div id="err"></div>
          <div class="field">
            <label for="name">Wer bist du?</label>
            <input id="name" required maxlength="60" placeholder="Dein Name" autocomplete="given-name">
          </div>
          <button class="btn block" type="submit">Anmelden</button>
        </form>
      </div>`}

      <div class="card">
        <h3>Schon dabei (${g.participants.length})</h3>
        <div class="names">${g.participants.map((p) => `<span class="pill">${esc(p.name)}</span>`).join("") || '<span class="muted">Noch niemand</span>'}</div>
      </div>
    `);

    const form = $("#join");
    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      busy(btn, true, "Melde an…");
      try {
        const name = $("#name").value.trim();
        const r = await rpc("join_group", { p_join_code: code, p_name: name });
        remember({ groupName: g.name, name, me: r.participant_token, code });
        location.hash = `#/me/${r.participant_token}?neu=1`;
      } catch (err) {
        $("#err").innerHTML = `<div class="error">${esc(err.message)}</div>`;
        busy(btn, false);
      }
    });
  }

  // ---------- Persönliche Seite ----------
  async function meView(token, params) {
    let d;
    try { d = await rpc("get_me", { p_token: token }); }
    catch (err) { return errorView(err.message); }
    const g = d.group;
    remember({ groupName: g.name, name: d.name, me: token, code: g.join_code });
    const myLink = links.me(token);
    const revealed = sessionStorage.getItem("revealed." + token) === "1";

    h(`
      ${params.get("neu") ? `<div class="notice">🎉 Du bist angemeldet! Dieser Link ist <strong>nur für dich</strong> – speichere ihn als Lesezeichen, damit du nach der Auslosung deinen Wichtel siehst. Auf diesem Gerät findest du ihn auch auf der Startseite.</div>` : ""}

      <div class="card">
        <p class="muted" style="margin-bottom:4px">Hallo ${esc(d.name)} 👋</p>
        <h1>${esc(g.name)}</h1>
        ${metaPills(g)}
        ${g.message ? `<p class="wishlist-text">${esc(g.message)}</p>` : ""}
      </div>

      ${d.receiver ? `
        <div class="card reveal" id="reveal">
          ${revealed ? receiverHtml(d.receiver) : `
            <p class="muted">Die Lose sind gezogen!</p>
            <button class="gift" id="open" aria-label="Geschenk öffnen">🎁</button>
            <p class="muted" style="margin-top:12px">Tippe auf das Geschenk, um zu sehen, wen du beschenkst.<br>Schau, dass dir niemand über die Schulter guckt 🤫</p>`}
        </div>
      ` : `
        <div class="card center">
          <p style="font-size:2.2rem;margin:0">⏳</p>
          <h2>Noch nicht ausgelost</h2>
          <p class="muted">Sobald der Organisator auslost, siehst du hier, wen du beschenkst. Komm einfach später über diesen Link wieder.</p>
          <div class="names" style="justify-content:center">${d.participants.map((p) => `<span class="pill">${esc(p.name)}</span>`).join("")}</div>
        </div>
      `}

      <div class="card">
        <h2>Dein Wunschzettel</h2>
        <p class="muted">Wer dich zieht, sieht diesen Text. Ideen, Größen, No-Gos – alles hilft.</p>
        <form id="wish">
          <textarea id="wishtext" maxlength="2000" placeholder="z.B. Gute Socken (Gr. 43), ein Krimi, Kaffee…">${esc(d.wishlist)}</textarea>
          <div class="btns" style="margin-top:10px"><button class="btn green" type="submit">Speichern</button></div>
        </form>
      </div>

      <div class="card">
        <h3>Dein persönlicher Link</h3>
        <p class="muted">Nicht weitergeben – damit sieht man, wen du gezogen hast.</p>
        <div class="linkbox">
          <input readonly value="${esc(myLink)}" aria-label="Persönlicher Link">
          <button class="btn ghost" id="copyme" type="button">Kopieren</button>
        </div>
      </div>
    `);

    $("#copyme").addEventListener("click", () => copy(myLink));
    $("#wish").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      busy(btn, true, "Speichert…");
      try { await rpc("update_wishlist", { p_token: token, p_wishlist: $("#wishtext").value }); toast("Wunschzettel gespeichert"); }
      catch (err) { toast(err.message); }
      busy(btn, false);
    });
    const openBtn = $("#open");
    if (openBtn) openBtn.addEventListener("click", () => {
      sessionStorage.setItem("revealed." + token, "1");
      $("#reveal").innerHTML = receiverHtml(d.receiver);
    });
  }

  function receiverHtml(r) {
    return `
      <p class="muted" style="margin:0">Du beschenkst</p>
      <div class="receiver-name">${esc(r.name)}</div>
      <p class="muted">Psst – nicht verraten! 🤫</p>
      ${r.wishlist ? `<h3 style="margin-top:18px">Wunschzettel von ${esc(r.name)}</h3><div class="wishlist-text">${esc(r.wishlist)}</div>`
        : `<p class="muted" style="margin-top:14px">${esc(r.name)} hat noch keinen Wunschzettel geschrieben. Schau später nochmal vorbei.</p>`}
    `;
  }

  // ---------- Admin ----------
  async function adminView(token, params) {
    let d;
    try { d = await rpc("admin_get", { p_admin_token: token }); }
    catch (err) { return errorView(err.message); }
    remember({ groupName: d.name, admin: token, code: d.join_code });

    const joinLink = links.join(d.join_code);
    const byId = Object.fromEntries(d.participants.map((p) => [p.id, p]));
    const inviteText = `🎁 Wichteln: ${d.name}! Trag dich hier ein:`;
    const seenCount = d.participants.filter((p) => p.seen).length;

    h(`
      ${params.get("neu") ? `<div class="notice">✅ Gruppe erstellt! Das hier ist deine <strong>Verwaltungsseite</strong> – speichere den Link. Schick jetzt den Einladungslink an alle.</div>` : ""}

      <div class="card">
        <p class="muted" style="margin-bottom:4px">Verwaltung</p>
        <h1>${esc(d.name)}</h1>
        ${metaPills(d)}
        <div class="meta">
          <span class="pill">👥 ${d.participants.length} Teilnehmer</span>
          ${d.drawn ? `<span class="pill ok">✔ Ausgelost</span>` : `<span class="pill">Noch nicht ausgelost</span>`}
          <span class="pill">Code <span class="code">${esc(d.join_code)}</span></span>
        </div>
      </div>

      ${!d.drawn ? `
      <div class="card">
        <h2>1. Einladen</h2>
        <p class="muted">Schick diesen Link in die Familiengruppe. Jeder trägt sich selbst ein und bekommt seinen eigenen Link.</p>
        <div class="linkbox" style="margin-bottom:10px">
          <input readonly value="${esc(joinLink)}" aria-label="Einladungslink">
          <button class="btn ghost" id="copyjoin" type="button">Kopieren</button>
        </div>
        <div class="btns">
          <button class="btn green" type="button" ${shareAttrs(inviteText, joinLink)}>Einladung teilen</button>
        </div>
      </div>` : ""}

      <div class="card">
        <h2>${d.drawn ? "Teilnehmer" : "2. Teilnehmer"}</h2>
        ${d.drawn
          ? `<p class="muted">${seenCount} von ${d.participants.length} haben schon nachgeschaut. Wer den eigenen Link verloren hat, bekommt ihn hier von dir.</p>`
          : `<p class="muted">Du kannst auch Leute selbst eintragen (z.B. Kinder oder Oma ohne Handy) und ihnen den persönlichen Link schicken oder ihn für sie öffnen.</p>`}
        <ul class="list">
          ${d.participants.map((p) => `
            <li>
              <span class="name">${esc(p.name)}
                ${d.drawn ? (p.seen ? ' <span class="pill ok">gesehen</span>' : ' <span class="pill">offen</span>') : ""}
                ${p.has_wishlist ? ' <span class="pill" title="Hat einen Wunschzettel">📝</span>' : ""}
              </span>
              <span class="actions">
                <button class="btn small ghost" type="button" ${shareAttrs(`🎁 ${d.name}: Hier ist dein persönlicher Wichtel-Link, ${p.name} (nicht weitergeben!):`, links.me(p.token))} title="Persönlichen Link schicken">Teilen</button>
                <button class="btn small ghost" data-copy="${esc(links.me(p.token))}" type="button" title="Persönlichen Link kopieren">Link</button>
                ${!d.drawn ? `<button class="btn small danger-text" data-remove="${esc(p.id)}" data-name="${esc(p.name)}" type="button" title="Entfernen">✕</button>` : ""}
              </span>
            </li>`).join("")}
        </ul>
        ${!d.drawn ? `
          <form id="add" class="linkbox" style="margin-top:12px">
            <input id="addname" maxlength="60" placeholder="Name hinzufügen" aria-label="Name hinzufügen">
            <button class="btn ghost" type="submit">Hinzufügen</button>
          </form>` : ""}
      </div>

      ${!d.drawn ? `
      <div class="card">
        <details ${d.exclusions.length ? "open" : ""}>
          <summary>Ausschlüsse <span class="hint">(optional – z.B. Paare sollen sich nicht gegenseitig ziehen)</span></summary>
          ${d.exclusions.length ? `<div style="margin-bottom:12px">${d.exclusions.map((x) => `
            <div class="excl-item">
              <span>${esc(byId[x.a]?.name)} ⇄ ${esc(byId[x.b]?.name)}</span>
              <button class="btn small danger-text" data-unexcl="${esc(x.a)}|${esc(x.b)}" type="button">Entfernen</button>
            </div>`).join("")}</div>` : ""}
          ${d.participants.length >= 2 ? `
          <form id="excl">
            <div class="row">
              <select id="ea" aria-label="Person 1">${d.participants.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
              <select id="eb" aria-label="Person 2">${d.participants.map((p, i) => `<option value="${esc(p.id)}" ${i === 1 ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
            </div>
            <button class="btn ghost block" type="submit" style="margin-top:10px">Diese zwei ziehen sich nicht</button>
          </form>` : `<p class="muted">Erst ein paar Teilnehmer hinzufügen.</p>`}
        </details>
      </div>

      <div class="card">
        <h2>3. Auslosen</h2>
        <p class="muted">Wenn alle drin sind: auslosen. Niemand – auch du nicht – sieht die ganze Zuordnung. Jeder sieht nur seinen eigenen Wichtel über seinen persönlichen Link.</p>
        <div id="drawerr"></div>
        <button class="btn block" id="draw" type="button" ${d.participants.length < 3 ? "disabled" : ""}>🎲 Jetzt auslosen</button>
        ${d.participants.length < 3 ? `<p class="hint center" style="margin-top:8px">Mindestens 3 Teilnehmer nötig.</p>` : ""}
      </div>
      ` : `
      <div class="card">
        <h2>Ausgelost 🎉</h2>
        <p class="muted">Sag allen Bescheid, dass sie über ihren persönlichen Link nachschauen können.</p>
        <div class="btns">
          <button class="btn green" type="button" ${shareAttrs(`🎁 ${d.name}: Die Lose sind gezogen! Schaut über euren persönlichen Link nach, wen ihr beschenkt. Link verloren? Sagt mir Bescheid.`, "")}>Allen Bescheid sagen</button>
        </div>
        <details style="margin-top:16px">
          <summary class="muted">Auslosung zurücksetzen</summary>
          <p class="muted">Löscht die aktuelle Zuordnung, z.B. wenn noch jemand dazukommt. Danach muss neu gelost werden und alle müssen erneut nachschauen.</p>
          <button class="btn ghost" id="reset" type="button">Zurücksetzen</button>
        </details>
      </div>
      `}

      <div class="card">
        <details>
          <summary>Gruppe bearbeiten</summary>
          <form id="edit">
            <div class="field"><label for="ename">Name</label><input id="ename" maxlength="80" value="${esc(d.name)}" required></div>
            <div class="row stack">
              <div class="field"><label for="ebudget">Budget</label><input id="ebudget" maxlength="40" value="${esc(d.budget)}"></div>
              <div class="field"><label for="edate">Bescherung</label><input id="edate" maxlength="40" value="${esc(d.event_date)}"></div>
            </div>
            <div class="field"><label for="emsg">Nachricht an alle</label><textarea id="emsg" maxlength="500">${esc(d.message)}</textarea></div>
            <button class="btn ghost" type="submit">Speichern</button>
          </form>
        </details>
      </div>

      <div class="card">
        <h3>Dein Verwaltungslink</h3>
        <p class="muted">Gut aufheben und nicht teilen – damit kann man die Gruppe verwalten.</p>
        <div class="linkbox">
          <input readonly value="${esc(links.admin(token))}" aria-label="Verwaltungslink">
          <button class="btn ghost" id="copyadmin" type="button">Kopieren</button>
        </div>
      </div>
    `);

    const reload = () => adminView(token, new URLSearchParams());
    const act = async (btn, fn, ok) => {
      busy(btn, true);
      try { await fn(); if (ok) toast(ok); await reload(); }
      catch (err) { toast(err.message); busy(btn, false); }
    };

    $("#copyadmin").addEventListener("click", () => copy(links.admin(token)));
    $("#copyjoin")?.addEventListener("click", () => copy(joinLink));
    $$("[data-share-text]").forEach((b) => b.addEventListener("click", () => share(b.dataset.shareText, b.dataset.shareUrl)));
    $$("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
    $$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      if (!confirm(`${b.dataset.name} wirklich entfernen?`)) return;
      act(b, () => rpc("admin_remove_participant", { p_admin_token: token, p_participant_id: b.dataset.remove }), "Entfernt");
    }));
    $$("[data-unexcl]").forEach((b) => b.addEventListener("click", () => {
      const [a, bb] = b.dataset.unexcl.split("|");
      act(b, () => rpc("admin_set_exclusion", { p_admin_token: token, p_a: a, p_b: bb, p_excluded: false }));
    }));
    $("#add")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#addname").value.trim();
      if (!name) return;
      act(e.submitter, () => rpc("admin_add_participant", { p_admin_token: token, p_name: name }), `${name} hinzugefügt`);
    });
    $("#excl")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = $("#ea").value, b = $("#eb").value;
      if (a === b) return toast("Bitte zwei verschiedene Personen wählen");
      act(e.submitter, () => rpc("admin_set_exclusion", { p_admin_token: token, p_a: a, p_b: b, p_excluded: true }), "Ausschluss gespeichert");
    });
    $("#draw")?.addEventListener("click", async (e) => {
      if (!confirm(`Jetzt mit ${d.participants.length} Teilnehmern auslosen? Danach kann sich niemand mehr selbst anmelden.`)) return;
      const btn = e.currentTarget;
      busy(btn, true, "Lose werden gezogen…");
      try {
        await rpc("admin_draw", { p_admin_token: token });
        toast("Ausgelost! 🎉");
        await reload();
      } catch (err) {
        $("#drawerr").innerHTML = `<div class="error">${esc(err.message)}</div>`;
        busy(btn, false);
      }
    });
    $("#reset")?.addEventListener("click", (e) => {
      if (!confirm("Auslosung wirklich zurücksetzen?")) return;
      act(e.currentTarget, () => rpc("admin_reset_draw", { p_admin_token: token }), "Zurückgesetzt");
    });
    $("#edit").addEventListener("submit", (e) => {
      e.preventDefault();
      act(e.submitter, () => rpc("admin_update_group", {
        p_admin_token: token, p_name: $("#ename").value, p_budget: $("#ebudget").value,
        p_event_date: $("#edate").value, p_message: $("#emsg").value,
      }), "Gespeichert");
    });
  }

  // ---------- Router ----------
  function route() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    const params = new URLSearchParams(query || "");
    const parts = path.split("/").filter(Boolean);
    if (parts[0] === "g" && parts[1]) return joinView(parts[1].toUpperCase());
    if (parts[0] === "me" && parts[1]) return meView(parts[1], params);
    if (parts[0] === "admin" && parts[1]) return adminView(parts[1], params);
    return homeView();
  }
  window.addEventListener("hashchange", route);
  route();
})();
